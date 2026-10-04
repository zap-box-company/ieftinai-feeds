import { test } from "node:test";
import assert from "node:assert/strict";
import { fromProfitshare, readProfitshare, rotationGroups } from "../src/profitshare.js";

const sample = {
  link: "https://www.vexio.ro/statii-radio/tti/147584-kit-tti-pack13/?utm=x",
  affiliate_link: "//app.profitshare.ro/lps/zP0/Dhp/?redirect=https%3A%2F%2Fwww.vexio.ro%2F",
  name: "Statie radio  Kit TTI-PACK13",
  image_original: "http://static.profitshare.ro/product_images/photos/50/65/40/50653682.jpeg",
  price_vat: 440.44, price: 364, price_discounted: "",
  brand_name: "TTi", category_name: "Statii Radio", part_number: "TTI-PACK13",
};

test("Profitshare product: VAT price, https links, store from the product URL", () => {
  assert.deepEqual(fromProfitshare(sample), {
    key: "vexio.ro:TTI-PACK13", store: "vexio.ro", title: "Statie radio Kit TTI-PACK13", price: 440.44, oldPrice: null,
    url: "https://www.vexio.ro/statii-radio/tti/147584-kit-tti-pack13/",
    affUrl: "https://app.profitshare.ro/lps/zP0/Dhp/?redirect=https%3A%2F%2Fwww.vexio.ro%2F",
    image: "https://static.profitshare.ro/product_images/photos/50/65/40/50653682.jpeg",
    brand: "TTi", category: "Statii Radio", gtin: null, mpn: "TTIPACK13", shipping: null,
  });
  assert.equal(fromProfitshare({ ...sample, price_vat: "" }), null);
});

test("reader pages every advertiser except eMAG", async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    const u = new URL(url);
    if (u.pathname === "/affiliate-advertisers/") return Response.json({ result: { a: { id: 35, name: "eMAG.ro" }, b: { id: 103131, name: "Vexio.ro" } } });
    const page = Number(u.searchParams.get("page"));
    return Response.json({ result: { total_pages: 2, products: [{ ...sample, part_number: `P${page}` }] } });
  };
  const products = await readProfitshare({ PS_API_USER: "u", PS_API_KEY: "k" }, { fetchImpl, log: () => {} });
  assert.deepEqual(products.map((p) => p.key).sort(), ["vexio.ro:P1", "vexio.ro:P2"]);
  assert.ok(!seen.some((u) => u.includes("filters[advertiser]=35")));
});

test("through the Worker proxy the import sends the daily token, not the API key", async () => {
  const seen = [];
  const fetchImpl = async (url, init) => { seen.push({ url, init }); return Response.json({ result: { a: { id: 1 } } }); };
  const { call } = await import("../src/profitshare.js");
  const r = await call({ PS_API_USER: "u", PS_API_KEY: "k", PS_PROXY_URL: "https://w.dev/" }, "affiliate-advertisers", "", fetchImpl);
  assert.deepEqual(r, { a: { id: 1 } });
  assert.equal(seen[0].url, "https://w.dev/v1/ps/affiliate-advertisers?");
  assert.match(seen[0].init.headers["X-Pipeline-Token"], /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(seen[0].init).includes('"k"'));
});

test("rotation: groups of similar size, every advertiser in exactly one", () => {
  const ads = [{ id: 1, pages: 2914 }, { id: 2, pages: 1755 }, { id: 3, pages: 1251 }, { id: 4, pages: 1080 }, { id: 5, pages: 707 }, { id: 6, pages: 590 }, { id: 7, pages: 1 }];
  const groups = rotationGroups(ads, 3);
  assert.deepEqual(groups.flatMap((g) => [...g]).sort(), ["1", "2", "3", "4", "5", "6", "7"]);
  const sizes = groups.map((g) => ads.filter((a) => g.has(String(a.id))).reduce((n, a) => n + a.pages, 0));
  assert.ok(Math.max(...sizes) - Math.min(...sizes) < 1200, String(sizes));
});
