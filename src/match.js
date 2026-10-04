// Title matching for "the same product in other shops" when there is no EAN to compare.
// Titles are normalized (lowercase, no diacritics, filler words out), then compared by the
// tokens they share and by edit distance; model codes and capacities must agree.

const FILLER = new Set([
  "promo", "promotie", "oferta", "pachet", "set", "nou", "noua", "original", "originala", "sigilat",
  "resigilat", "garantie", "transport", "gratuit", "cu", "si", "de", "la", "pentru", "in", "din", "the", "and", "with",
]);

export function normalizeTitle(title) {
  return String(title ?? "")
    .normalize("NFD").replace(/\p{Mn}/gu, "")
    .toLowerCase()
    .replace(/([a-z0-9])\+/g, "$1 plus") // "S26+" -> "s26 plus", like "Galaxy S26 Plus"
    .replace(/(\d+)\s*(gb|tb|mb|mah|w|hz|inch|inci|ml|l|kg|g|mm|cm)\b/g, "$1$2") // "256 GB" -> "256gb"
    .match(/[\p{L}\p{N}]+/gu)
    ?.filter((w) => !FILLER.has(w))
    .join(" ") ?? "";
}

/** Classic Levenshtein distance (two rows). */
export function levenshtein(a, b) {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Colour words: two titles naming different colours are different variants (evoMAG listed 3). */
const COLORS = new Set([
  "negru", "neagra", "alb", "alba", "gri", "argintiu", "argintie", "auriu", "aurie", "albastru", "albastra", "rosu", "rosie",
  "verde", "galben", "galbena", "roz", "mov", "violet", "portocaliu", "maro", "bej", "crem", "turcoaz", "bleumarin", "grafit",
  "black", "white", "silver", "gold", "blue", "red", "green", "pink", "purple", "gray", "grey", "graphite", "navy", "midnight", "starlight",
]);

/**
 * Manufacturer part number as stored and compared: uppercase letters and digits only, 5–30 long,
 * with both letters and digits ("SM-S948BZKDEUE" -> "SMS948BZKDEUE"); anything else is null
 * (plain shop ids like "12345" are not manufacturer codes).
 */
export function normalizeMpn(code) {
  const c = String(code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return c.length >= 5 && c.length <= 30 && /[A-Z]/.test(c) && /[0-9]/.test(c) ? c : null;
}

/** Words that name another model of the same line. */
const VARIANTS = new Set(["plus", "ultra", "pro", "max", "mini", "lite", "fe", "edge"]);

/** Romanian and English names of the same colour, one name each. */
const COLOR_SYNONYMS = {
  neagra: "negru", black: "negru", midnight: "negru",
  alba: "alb", white: "alb", starlight: "alb",
  gray: "gri", grey: "gri",
  argintie: "argintiu", silver: "argintiu",
  aurie: "auriu", gold: "auriu",
  albastra: "albastru", blue: "albastru",
  rosie: "rosu", red: "rosu",
  green: "verde",
  galbena: "galben",
  pink: "roz",
  purple: "mov", violet: "mov",
  navy: "bleumarin",
  graphite: "grafit",
};
const sameColor = (w) => COLOR_SYNONYMS[w] ?? w;

/** First words of accessories that carry the product's name ("Husa Samsung Galaxy S25"). */
const ACCESSORY = new Set([
  "husa", "folie", "sticla", "protector", "protectie", "cablu", "incarcator", "adaptor", "carcasa", "suport",
  "curea", "bratara", "geanta", "stand", "skin", "toc", "accesoriu", "accesorii", "cartus", "baterie",
]);

/** Tokens that pin a variant: capacities ("256gb") and model codes with digits ("s25", "a56", "21034"). */
const isSpec = (t) => /\d/.test(t);

/**
 * Manufacturer model codes ("50s5l", "s931b", "ua55du7172"): letters and digits, 5+ characters,
 * not a measure ("126cm", "2x10w") or a standard ("hdr10", "dvbt2"). One on both titles names the
 * same product even when one shop's title is twice as long (Ozone vs Flanco, TCL 50S5L).
 */
const STANDARDS = new Set(["hdr10", "dvbt2", "dvbs2", "dvbc2", "ddr4", "ddr5", "lpddr5", "wifi6", "wifi7", "usb30", "usb31", "usb32", "h265", "hevc265", "x86", "64bit"]);
const isModelCode = (t) => t.length >= 5 && /[a-z]/.test(t) && /d/.test(t) && !STANDARDS.has(t)
  && !/^d+(gb|tb|mb|mah|w|hz|inch|inci|ml|l|kg|g|mm|cm)$/.test(t) && !/^d+xd+/.test(t);

/**
 * 0..1 similarity of two product titles. Different capacities or model numbers on both sides
 * mean different products (iPhone 17 128GB vs 256GB), whatever the rest says.
 */
export function titleSimilarity(a, b) {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return 0;
  const wa = na.split(" ");
  const wb = nb.split(" ");
  if (ACCESSORY.has(wa[0]) !== ACCESSORY.has(wb[0])) return 0; // a case is not the phone
  // Compared by meaning: "Negru" at dwyn.ro is "Black" at eMAG.
  const ca = wa.filter((w) => COLORS.has(w)).map(sameColor);
  const cb = wb.filter((w) => COLORS.has(w)).map(sameColor);
  if (ca.length && cb.length && !ca.some((c) => cb.includes(c))) return 0; // other colour, other variant
  const ta = new Set(wa);
  const tb = new Set(wb);
  // S26 vs S26+ / S26 Ultra, iPhone 17 vs 17 Pro Max: a variant word on one side only = other model.
  const va = [...ta].filter((w) => VARIANTS.has(w)).sort().join(" ");
  const vb = [...tb].filter((w) => VARIANTS.has(w)).sort().join(" ");
  if (va !== vb) return 0;
  const specA = [...ta].filter(isSpec);
  const specB = [...tb].filter(isSpec);
  if (specA.length && specB.length && !specA.some((s) => tb.has(s)) ) return 0;
  if (specA.some((s) => /\d+(gb|tb)$/.test(s) && specB.some((x) => /\d+(gb|tb)$/.test(x)) && !tb.has(s))) return 0;
  const shared = [...ta].filter((t) => tb.has(t)).length;
  const dice = (2 * shared) / (ta.size + tb.size);
  const edit = 1 - levenshtein(na, nb) / Math.max(na.length, nb.length);
  const sameModel = [...ta].some((t) => isModelCode(t) && tb.has(t));
  return Math.max(dice, edit, sameModel ? 0.7 : 0);
}

export const SAME_PRODUCT = 0.6;
