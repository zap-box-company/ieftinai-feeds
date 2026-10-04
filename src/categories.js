// Maps the shops' own category names ("Puzzle-uri clasice", "Monitoare") onto eMAG's category tree
// (12 departments → 76 groups → 246 categories, research/emag-categories.json), so pretai.ro and the
// app browse the way Romanians already know from eMAG. Pure text matching on stemmed words.
import { readFileSync } from "node:fs";

export const EMAG_TREE = JSON.parse(readFileSync(new URL("./emag-categories.json", import.meta.url), "utf8"));

const STOP = new Set(["si", "de", "la", "cu", "pentru", "din", "in", "pe", "sau", "alte", "altele", "accesorii", "produse", "&"]);

/** Words without diacritics, stopwords out, cut to a 5-letter stem ("puzzle-uri" ~ "puzzl", "monitoare" ~ "monit"). */
export function stems(text) {
  return String(text ?? "")
    .normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase()
    .match(/[\p{L}\p{N}]+/gu)
    ?.filter((w) => w.length > 1 && !STOP.has(w))
    .map((w) => (w.length > 6 ? w.slice(0, 6) : w)) ?? [];
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
  const fs = stems(feedCategory);
  if (!fs.length) return null;
  let best = null;
  for (const t of TARGETS) {
    // The head word ("Unelte" in "Unelte electrice") must be in the eMAG category, not just any word.
    if (!t.s.includes(fs[0]) && !t.gs.includes(fs[0])) continue;
    const score = overlap(fs, t.s) * 0.7 + overlap(t.s, fs) * 0.2 + overlap(fs, t.gs) * 0.1 + (fs.join(" ") === t.s.join(" ") ? 0.5 : 0);
    if (!best || score > best.score) best = { ...t, score };
  }
  if (best && best.score >= threshold) return { dept: best.dept, slug: best.slug, name: best.name, score: Math.round(best.score * 100) / 100 };
  return null;
}
