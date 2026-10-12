import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCsv, parseCsvObjects } from "../src/csv.js";
import { feedUrlsFrom, fromTwoPerformant, normalizeGtin, parsePrice } from "../src/normalize.js";
import { COST, lit, plan } from "../src/plan.js";

async function* chunks(...parts) { yield* parts; }
const collect = async (it) => { const out = []; for await (const x of it) out.push(x); return out; };

test("csv: quotes, escaped quotes, newlines inside fields, chunk boundaries", async () => {
  const rows = await collect(parseCsv(chunks('a,"b ""q"" c","multi\nline"\r\n', "x,", '"y', '",z\n')));
  assert.deepEqual(rows, [["a", 'b "q" c', "multi\nline"], ["x", "y", "z"]]);
});

test("csv objects use lower-cased headers", async () => {
  const rows = await collect(parseCsvObjects(chunks('"Title","Price"\n"Mouse","59.99"\n')));
  assert.deepEqual(rows, [{ title: "Mouse", price: "59.99" }]);
});

test("prices", () => {
  assert.equal(parsePrice("1.299,99"), 1299.99);
  assert.equal(parsePrice("1299.99"), 1299.99);
  assert.equal(parsePrice("1,299.99"), 1299.99);
  assert.equal(parsePrice("1.299"), 1299);
  assert.equal(parsePrice("0"), null);
  assert.equal(parsePrice(""), null);
});

test("gtin keeps only valid check digits, canonical 14 digits", () => {
  assert.equal(normalizeGtin("5702017161884"), "05702017161884");
  assert.equal(normalizeGtin("5702017161885"), null);
  assert.equal(normalizeGtin("abc"), null);
});

test("2performant row -> product, product id from the affiliate link when missing", () => {
  const p = fromTwoPerformant({
    title: "Mouse Optic Wireless Logitech M185",
    aff_code: "https://event.2performant.com/events/click?ad_type=product_store&unique=16f4d8039&aff_code=5f985f8e1&campaign_unique=d4f678b43",
    price: "59.99",
    campaign_name: "evomag.ro ",
    image_urls: "https://static2.evomag.ro/a.jpg,https://static2.evomag.ro/b.jpg",
    old_price: "79.99",
    gtin: "5099206064270",
  });
  assert.equal(p.key, "evomag.ro:16f4d8039");
  assert.equal(p.store, "evomag.ro");
  assert.equal(p.price, 59.99);
  assert.equal(p.oldPrice, 79.99);
  assert.equal(p.image, "https://static2.evomag.ro/a.jpg");
  assert.equal(p.gtin, normalizeGtin("5099206064270"));
  assert.equal(fromTwoPerformant({ title: "x", price: "0", aff_code: "u", campaign_name: "s" }), null);
});

test("sql literals escape quotes and reject non-finite numbers", () => {
  assert.equal(lit("O'Neil"), "'O''Neil'");
  assert.equal(lit(null), "NULL");
  assert.equal(lit(12.5), "12.5");
  assert.throws(() => lit(Infinity));
});

test("plan: price changes first, then new products with GTIN, within budget", () => {
  const mk = (key, price, gtin = null) => ({ key, store: "s", title: key, price, oldPrice: null, url: null, affUrl: "a", image: null, brand: null, category: null, gtin });
  const current = new Map([["s:1", { price: 100, oldPrice: null, title: "s:1", brand: null, url: null, image: null, gtin: null, category: null }]]);
  const records = [mk("s:new-plain", 5), mk("s:new-gtin", 6, "05702017161884"), mk("s:1", 80)];

  const all = plan(records, current, 20261003, 1000);
  assert.deepEqual(all.stats.done, { priceChanges: 1, inserts: 2, metaChanges: 0 });
  assert.match(all.statements[0], /UPDATE products SET price=80, .*prev_price=100, drop_pct=20, updated_day=20261003 WHERE key='s:1'/);
  assert.match(all.statements[2], /'s:new-gtin'/); // GTIN products are inserted before others

  const tight = plan(records, current, 20261003, COST.priceUpdate + COST.insert); // one price update + one insert
  assert.deepEqual(tight.stats.done, { priceChanges: 1, inserts: 1, metaChanges: 0 });
  assert.equal(tight.stats.pending.inserts, 2);
});

test("feed text: HTML entities decoded", async () => {
  const { decodeEntities } = await import("../src/normalize.js");
  assert.equal(decodeEntities("Accesorii &#x3E; Volane &amp; joystick-uri &#8211; nou"), "Accesorii > Volane & joystick-uri – nou");
});

test("compact catalog: metadata changes are found through the signature", async () => {
  const { plan, metaSig } = await import("../src/plan.js");
  const r = { key: "s:1", store: "s", title: "Lego 21034", price: 100, oldPrice: null, brand: "LEGO", url: "u", image: "i", gtin: null, category: "Jucarii", shipping: null };
  const same = new Map([["s:1", { price: 100, oldPrice: null, sig: metaSig(r) }]]);
  assert.equal(plan([r], same, 20261004, 1000).stats.pending.metaChanges, 0);
  const renamed = new Map([["s:1", { price: 100, oldPrice: null, sig: metaSig({ ...r, title: "Lego Londra" }) }]]);
  assert.equal(plan([r], renamed, 20261004, 1000).stats.pending.metaChanges, 1);
});

test("metadata change: only the groups that changed are written, the others match nothing", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { metaStatements } = await import("../src/plan.js");
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE products (key TEXT PRIMARY KEY, title TEXT, brand TEXT, url TEXT, aff_url TEXT, image TEXT, gtin TEXT, category TEXT, shipping REAL, mpn TEXT)");
  db.exec("INSERT INTO products VALUES ('s:1', 'Lego 21034', 'LEGO', 'u', 'a', 'https://static.profitshare.ro/x.jpg', NULL, 'Jucarii', NULL, NULL)");
  const r = { key: "s:1", title: "Lego 21034", brand: "LEGO", url: "u2", affUrl: "a", image: "https://shop/x.jpg", gtin: null, category: "Jucarii", shipping: null, mpn: null };
  const changed = metaStatements(r).map((sql) => Number(db.prepare(sql).run().changes));
  assert.deepEqual(changed, [1, 0, 0, 0, 0]);
  assert.deepEqual({ ...db.prepare("SELECT url, image, title FROM products").get() }, { url: "u2", image: "https://shop/x.jpg", title: "Lego 21034" });
  assert.deepEqual(metaStatements({ ...r, category: "Lego" }).map((sql) => Number(db.prepare(sql).run().changes)), [0, 0, 0, 1, 0]);
});

test("2Performant program names become bare shop domains", async () => {
  const { fromTwoPerformant } = await import("../src/normalize.js");
  const p = fromTwoPerformant({ title: "Set oale", price: "99", aff_code: "https://event.2performant.com/x", campaign_name: "bazarulonline.ro/ ", product_id: "7" });
  assert.equal(p.store, "bazarulonline.ro");
});

test("Profitshare products are inserted before the rest, whatever their EAN", async () => {
  const { plan, COST } = await import("../src/plan.js");
  const mk = (key, gtin, priority) => ({ key, store: key.split(":")[0], title: key, price: 10, oldPrice: null, url: "u", affUrl: "a", image: null, brand: null, category: null, gtin, priority });
  const r = plan([mk("ozone.ro:1", "5901234123457"), mk("vegis.ro:1", null, 0)], new Map(), 20261004, COST.insert);
  assert.match(r.statements[0], /vegis.ro:1/);
});

test("feed links: one or several per secret, split on spaces, commas and new lines", () => {
  const a = "https://api.2performant.com/feed/aaa.csv";
  const b = "https://feeds.2performant.com/feed/bss.csv";
  assert.deepEqual(feedUrlsFrom(a, undefined), [a]);
  assert.deepEqual(feedUrlsFrom(a, `"${b}"
${a} , https://x.ro/c.csv
`), [a, b, "https://x.ro/c.csv"]);
  assert.deepEqual(feedUrlsFrom("", "not a link"), []);
});
