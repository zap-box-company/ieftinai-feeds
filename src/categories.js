// Maps the shops' own category names ("Puzzle-uri clasice", "Monitoare") onto eMAG's category tree
// (12 departments → 76 groups → 246 categories, research/emag-categories.json), so pretai.ro and the
// app browse the way Romanians already know from eMAG. Pure text matching on stemmed words.
import { readFileSync } from "node:fs";

export const EMAG_TREE = JSON.parse(readFileSync(new URL("./emag-categories.json", import.meta.url), "utf8"));

const AUDIENCE = new Set(["dama", "barbat", "copii", "unisex", "baieti", "fete", "bebe"]);
const STOP = new Set(["si", "de", "la", "cu", "pentru", "din", "in", "pe", "sau", "alte", "altele", "accesorii", "produse", "&", "engros", "uri"]);

/** Words without diacritics, stopwords out, cut to a 5-letter stem ("puzzle-uri" ~ "puzzl", "monitoare" ~ "monit"). */
export function stems(text) {
  return String(text ?? "")
    .normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase()
    .match(/[\p{L}\p{N}]+/gu)
    ?.filter((w) => w.length > 1 && !STOP.has(w))
    // eMAG says "dama" where shops say "femei".
    .map((w) => (/^femei/.test(w) ? "dama" : w.length > 6 ? w.slice(0, 6) : w)) ?? [];
}

const overlap = (a, b) => {
  if (!a.length || !b.length) return 0;
  const sb = new Set(b);
  const shared = new Set(a.filter((w) => sb.has(w))).size;
  return shared / Math.max(new Set(a).size, 1);
};

/** Every place a product can go, with its stems: categories first, then groups, then departments. */
const TARGETS = EMAG_TREE.flatMap((d) => [
  ...d.groups.flatMap((g) => g.categories.map((c) => ({ level: "category", dept: d.slug, group: g.name, slug: c.slug, name: c.name, s: stems(c.name), gs: stems(g.name) }))),
]);

/**
 * Best eMAG category for a shop category: shared stems with the category name (the group name helps
 * break ties). Below the threshold the product goes to the closest group, else to "Altele".
 */
const plain = (t) => String(t ?? "").normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Hand-made mappings for the biggest shop categories (src/category-overrides.json), checked against eMAG. */
const OVERRIDES = new Map(Object.entries(JSON.parse(readFileSync(new URL("./category-overrides.json", import.meta.url), "utf8"))));
const BY_SLUG = new Map(TARGETS.map((t) => [t.slug, t]));

export function mapCategory(feedCategory, { threshold = 0.45 } = {}) {
  const hand = OVERRIDES.get(plain(feedCategory)) ?? OVERRIDES.get(plain(String(feedCategory).split(">").pop()));
  if (hand === "-") return null; // a shop category that fits nowhere in the tree: better unmapped than wrong
  // (Stems are 6 letters: with 5, "mobilier" matched "mobile" and garden furniture landed in phones.)
  if (hand && BY_SLUG.has(hand)) {
    const t = BY_SLUG.get(hand);
    return { dept: t.dept, slug: t.slug, name: t.name, score: 1 };
  }
  // A path ("Laptop, Tablete si Telefoane>Tablete>Accesorii tablete") goes by its last step: its first
  // words name the department, and tablet cases went to laptops (user, 2026-10-12). The steps before
  // only break ties ("BARBATI > TRICOURI" is men's T-shirts). A last step that fits nowhere ("Alte
  // accesorii") leaves the path unmapped; a plain one ("Side by side") takes its parent's.
  const steps = String(feedCategory).split(">").map((x) => x.trim()).filter(Boolean);
  if (steps.length > 1) {
    const last = steps.at(-1);
    const best = matchOne(last, threshold, stems(steps.slice(0, -1).join(" ")));
    if (best) return result(best);
    if (/accesori|altele|alte /.test(plain(last))) return null;
    return mapCategory(steps.slice(0, -1).join(">"), { threshold });
  }
  // A department that names several kinds of products ("Laptop, Telefoane, Tablete", "Laptop-Desktop")
  // holds them all, cables and cases too: unmapped when its kinds land in different eMAG groups.
  if (!/^accesori/.test(plain(feedCategory))) {
    const kinds = String(feedCategory).split(/\s*(?:,|&|\+|\/|\bsi\b|\bși\b|\s-\s)\s*|-(?!uri\b|urile\b|ul\b)/i).filter((k) => stems(k).length);
    if (kinds.length > 1) {
      // Only kinds that clearly name a category count ("Gaming" in "Mouse PC / Gaming" does not).
      const groups = new Set(kinds.map((k) => matchOne(k, threshold)).filter((m) => m && m.score >= 0.7).map((m) => m.group));
      if (groups.size > 1) return null;
    }
  }
  const best = matchOne(feedCategory, threshold);
  return best ? result(best) : null;
}

const result = (t) => ({ dept: t.dept, slug: t.slug, name: t.name, score: Math.round(t.score * 100) / 100 });

/**
 * The words an eMAG category has beyond the shop's last step ("barbati" in "Pantaloni barbati" or its group "Imbracaminte barbati" for
 * "BARBATI > PANTALONI"): a bonus when the steps above say them, a cost when they do not, so the
 * plain "Pantaloni" (women's) does not win on its exact name alone.
 */
function contextFit(t, fs, context) {
  if (!context.length) return 0;
  const extra = [...new Set([...t.s, ...t.gs])].filter((w) => !fs.includes(w));
  if (!extra.length) return 0;
  // Said for men, the women's category is wrong whatever else fits (and the other way round).
  if (context.some((w) => AUDIENCE.has(w)) && extra.some((w) => AUDIENCE.has(w) && !context.includes(w))) return -1;
  const said = extra.filter((w) => context.includes(w)).length;
  return (0.6 * said - 0.3 * (extra.length - said)) / extra.length;
}

/** [context]: stems of the steps above a path's last one, used only to break ties. */
function matchOne(feedCategory, threshold, context = []) {
  const fs = stems(feedCategory);
  // Only who it is for ("Femei", "Pentru barbati"): no kind of product to go by.
  if (!fs.length || fs.every((w) => AUDIENCE.has(w))) return null;
  let best = null;
  // "Accesorii Telefoane Mobile" holds cables and screen protectors: only an accessories category
  // ("alte-accesorii-telefoane") fits, never the phones themselves.
  const accessories = /^accesori/.test(plain(feedCategory));
  for (const t of TARGETS) {
    if (accessories && !t.slug.includes("accesori")) continue;
    // The head word ("Unelte" in "Unelte electrice") must be in the eMAG category, not just any word.
    if (!t.s.includes(fs[0]) && !t.gs.includes(fs[0])) continue;
    const score = overlap(fs, t.s) * 0.7 + overlap(t.s, fs) * 0.2 + overlap(fs, t.gs) * 0.1 + (fs.join(" ") === t.s.join(" ") ? 0.5 : 0) + contextFit(t, fs, context);
    if (!best || score > best.score) best = { ...t, score };
  }
  return best && best.score >= threshold ? best : null;
}

/**
 * Lowest believable price (lei) of a device, by the eMAG category its shop category maps to, and the
 * start of a title that names the device itself: pcmadd.com's feed gave laptops at 23 and 90 lei that
 * its pages sell at 2,057 (user, 2026-10-12). A feed row that reads like the device and costs less is
 * left out; the product keeps the price it had. Bags, batteries and games filed under these categories
 * do not start with the device's name, so their real low prices still come in.
 */
export const PRICE_FLOOR = {
  laptopuri: [300, /^(laptop|notebook|ultrabook|(apple )?macbook)\b/i],
  "desktop-pc": [300, /^(sistem desktop|desktop pc|calculator|unitate pc)\b/i],
  "telefoane-mobile": [50, /^(telefon mobil|smartphone)\b/i],
  tablete: [80, /^tablet[aă]\b(?! efervesc)/i],
  televizoare: [250, /^(televizor|smart tv)\b/i],
  "monitoare-lcd-led": [100, /^monitor\b/i],
  frigidere: [150, /^frigider\b/i],
  "combine-frigorifice": [600, /^combin[aă] frigorific/i],
  "masini-spalat-rufe": [200, /^ma[sș]in[aă] de sp[aă]lat rufe/i],
  "masini-spalat-vase": [600, /^ma[sș]in[aă] de sp[aă]lat vase/i],
};
const floorOf = new Map();
export function implausiblePrice(r) {
  if (!r.category) return false;
  if (!floorOf.has(r.category)) floorOf.set(r.category, PRICE_FLOOR[mapCategory(r.category)?.slug] ?? null);
  const floor = floorOf.get(r.category);
  return !!floor && r.price < floor[0] && floor[1].test(String(r.title ?? "").trim());
}
