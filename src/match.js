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
    .replace(/ultra[\s-]*hd/g, "uhd") // a "4K Ultra HD" television is not the "Ultra" model of anything
    .replace(/(\d+)\s*(gb|tb|mb|mah|w|kw|hz|inch|inci|ml|l|kg|g|mm|cm|rpm|mp|db|btu)\b/g, "$1$2") // "256 GB" -> "256gb"
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
  "black", "white", "silver", "gold", "blue", "red", "green", "pink", "purple", "gray", "grey", "graphite", "navy", "midnight", "starlight", "orange", "yellow", "brown", "beige",
]);

/**
 * Manufacturer part number as stored and compared: uppercase letters and digits only, 5–30 long,
 * with both letters and digits ("SM-S948BZKDEUE" -> "SMS948BZKDEUE"); anything else is null
 * (plain shop ids like "12345" are not manufacturer codes).
 */
export function normalizeMpn(code) {
  // Region or package suffixes after "." or "/" ("22U401A-B.AEUQ", "MQ8N3ZD/A") name the same model.
  const raw = String(code ?? "");
  const core = raw.split(/[./]/)[0];
  const c = (core.replace(/[^A-Za-z0-9]/g, "").length >= 5 ? core : raw).toUpperCase().replace(/[^A-Z0-9]/g, "");
  return c.length >= 5 && c.length <= 30 && /[A-Z]/.test(c) && /[0-9]/.test(c) ? c : null;
}

/**
 * Manufacturer codes a title carries ("…Tefal Equinox TT420D30, 900W…" -> ["TT420D30"]), written
 * like stored part numbers: where one shop publishes the code as data and another only in its
 * title, the two meet on it. Six characters and more, at most three.
 */
export function titleCodes(title) {
  return normalizeTitle(title).split(" ").filter((t) => t.length >= 6 && isModelCode(t)).slice(0, 3).map((t) => t.toUpperCase());
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
  orange: "portocaliu", yellow: "galben", brown: "maro", beige: "bej",
};
const sameColor = (w) => COLOR_SYNONYMS[w] ?? w;

/** First words of accessories that carry the product's name ("Husa Samsung Galaxy S25"). */
const ACCESSORY = new Set([
  "husa", "folie", "sticla", "protector", "protectie", "cablu", "incarcator", "adaptor", "carcasa", "suport",
  "curea", "bratara", "geanta", "stand", "skin", "toc", "accesoriu", "accesorii", "cartus", "baterie",
  "capac", "huse", "folii", "display", "ecran", "acumulator", "rama", "banda", "conector", "mufa", "modul",
]);

/** Tokens that pin a variant: capacities ("256gb") and model codes with digits ("s25", "a56", "21034"). */
const isSpec = (t) => /\d/.test(t);

/**
 * Manufacturer model codes ("50s5l", "s931b", "ua55du7172"): letters and digits, 5+ characters,
 * not a measure ("126cm", "2x10w") or a standard ("hdr10", "dvbt2"). One on both titles names the
 * same product even when one shop's title is twice as long (Ozone vs Flanco, TCL 50S5L).
 */
const STANDARDS = new Set(["hdr10", "dvbt2", "dvbs2", "dvbc2", "ddr4", "ddr5", "lpddr5", "wifi6", "wifi7", "usb30", "usb31", "usb32", "h265", "hevc265", "x86", "64bit"]);
const isModelCode = (t) => t.length >= 5 && /[a-z]/.test(t) && /\d/.test(t) && !STANDARDS.has(t) && !isMeasure(t);

/** Model names ("s25", "a56", "50s5l") and bare numbers ("17", "60312"), as opposed to measures ("256gb", "5g", "4k"). */
// Measures and resolutions ("1080p", "4k", "60fps"): many different products share them.
/**
 * Specifications written like codes, found by counting how many brands share a token in 48,000
 * catalog titles: none of them tells one product from another.
 */
const SPEC_PATTERNS = [
  /^\d{2,3}r\d{2}c?$/, // tyre size: 205/55R16, 65R16C
  /^spf\d+$/, // sun protection factor
  /^cat\d[a-z]?$/, // network cable class
  /^l?p?g?ddr\d[a-z]?$/, // memory type: ddr5, gddr6, lpddr5
  /^(usb|hdmi|wifi|bt|ip|rj|sata|pcie|euro)\d+[a-z]?$/, // interfaces and ratings: usb3, hdmi21, ip68, rj45, euro6
  /^[a-z]{1,2}\d{1,2}w$/, // bulb types: py21w, p21w
  /^plus\d+$/, // "2+1" after the + is spelled out
  /^\d+in\d+$/, // 2in1
  /^\d+(st|nd|rd|th)$/, // ordinals
  /^3pmsf$/, // winter tyre mark
];
const isMeasure = (t) => /^[ø]?\d+(gb|tb|mb|mah|w|kw|hz|khz|inch|inci|ml|l|kg|g|mm|cm|m|k|p|fps|buc|pcs|rpm|mp|db|btu|v|ah|dpi|ms|nm|bar|lm|va|mg|mcg|gr|cps|cpr|tbl|cc|atm|mhz|ghz|mbps|gbps|kwh|wh|ohm)$/.test(t) || /^\d+x\d+/.test(t) || SPEC_PATTERNS.some((p) => p.test(t));
/**
 * What only one model carries: a manufacturer code ("wmled1207new", "43u8072h") or a model number of
 * four digits and more that is not a year ("7259" in "WRSB 7259").
 */
const isDistinctive = (t) => t.length >= 4 && !isMeasure(t) && !STANDARDS.has(t) && !/^(19|20)\d\d$/.test(t)
  && (/^\d+$/.test(t) || (t.length >= 5 && /[a-z]/.test(t) && /\d/.test(t)));
const isModelName = (t) => /[a-z]/.test(t) && /\d/.test(t) && !STANDARDS.has(t) && !isMeasure(t);
const isPlainNumber = (t) => /^\d+$/.test(t);
/** "i7" -> "a9", "13620h" -> "99999a": codes written the same way name the same kind of part. */
const shape = (t) => t.replace(/[a-z]/g, "a").replace(/\d/g, "9");

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
  // Storage must agree (the biggest size on each side); the memory too, when both titles name it. A
  // shop that writes only "256GB" still sells the phone another shop calls "12GB RAM, 256GB".
  const sizes = (list) => list.filter((s) => /^\d+(gb|tb)$/.test(s)).map((s) => Number(s.match(/^\d+/)[0]) * (s.endsWith("tb") ? 1024 : 1)).sort((x, y) => y - x);
  const sa = sizes(specA);
  const sb = sizes(specB);
  if (sa.length && sb.length && (sa[0] !== sb[0] || (sa.length > 1 && sb.length > 1 && sa[1] !== sb[1]))) return 0;
  // Model names must agree too: Galaxy S25 is not S26 and PlayStation 4 is not 5, even when the
  // capacity and the colour are the same.
  // The same manufacturer code in both titles ("TT420D30") pins the model by itself: the bare numbers
  // around it are then quantities ("7 viteze" in one shop, "900 W" in the other), not model numbers.
  const pinned = specA.some((s) => isModelCode(s) && s.length >= 6 && tb.has(s));
  for (const kind of pinned ? [isModelName] : [isModelName, isPlainNumber]) {
    const ma = specA.filter(kind);
    const mb = specB.filter(kind);
    // A shop's longer code holds the short one: "43u8072h" is "ue43u8072huxxh".
    const held = (m) => m.length >= 5 && mb.some((x) => x.length >= 5 && (x.includes(m) || m.includes(x)));
    if (ma.length && mb.length && !ma.some((m) => tb.has(m) || held(m))) return 0;
  }
  // A shared model code is not enough when another one differs: the Vivobook X1502VA with
  // "i5-13420H" is not the one with "i7-13620H". Two codes of the same shape, each on one side only.
  const onlyA = specA.filter((s) => isModelName(s) && !tb.has(s));
  const onlyB = new Set(specB.filter((s) => isModelName(s) && !ta.has(s)).map(shape));
  if (onlyA.some((s) => onlyB.has(shape(s)))) return 0;
  // Two washing machines share "7 kg, 1200rpm, Clasa B, alb" and little else: when both titles
  // carry a code of their own and none is found in the other's ("43u8072h" inside "ue43u8072huxxh"
  // counts), they are different models, whatever the common words say.
  const da = specA.filter(isDistinctive);
  const db = specB.filter(isDistinctive);
  if (da.length && db.length && !da.some((x) => db.some((y) => x.includes(y) || y.includes(x)))) return 0;
  // Same for quantities: a 50 ml perfume is not the 100 ml one, 500 g is not 1 kg.
  for (const unit of ["ml", "l", "g", "kg"]) {
    const qa = specA.filter((s) => new RegExp(`^\\d+${unit}$`).test(s));
    const qb = specB.filter((s) => new RegExp(`^\\d+${unit}$`).test(s));
    if (qa.length && qb.length && !qa.some((q) => qb.includes(q))) return 0;
  }
  const shared = [...ta].filter((t) => tb.has(t)).length;
  const dice = (2 * shared) / (ta.size + tb.size);
  const edit = 1 - levenshtein(na, nb) / Math.max(na.length, nb.length);
  // The shortcut is for a model named in the title, not for one in a list of cars a part fits
  // ("Senzor … MERCEDES UNIMOG, A (W168) … CL203"): the code must come early in both titles, and
  // the titles must start alike (a sensor is not a water pump for the same truck).
  const startsAlike = wa.slice(0, 4).some((w) => wb.slice(0, 4).includes(w));
  const sameModel = startsAlike && wa.slice(0, 8).some((t) => isModelCode(t) && wb.slice(0, 8).includes(t));
  // A long code early in both titles names the product even when the shops call it differently
  // ("Dispozitiv de vacuum Tefal VT254070" is the "Aparat de vidat VacuPack Classic VT254070").
  const longCode = wa.slice(0, 8).some((t) => isModelCode(t) && t.length >= 7 && wb.slice(0, 8).includes(t));
  return Math.max(dice, edit, sameModel || longCode ? 0.7 : 0);
}

export const SAME_PRODUCT = 0.6;

/** What kind of thing a title sells, by its words; several words for one kind share a name. */
const KINDS = {
  telefon: "telefon", smartphone: "telefon", iphone: "telefon", laptop: "laptop", notebook: "laptop", macbook: "laptop", ultrabook: "laptop",
  tableta: "tableta", ipad: "tableta", televizor: "televizor", tv: "televizor", monitor: "monitor", smartwatch: "ceas", ceas: "ceas",
  casti: "casti", boxa: "boxa", soundbar: "boxa", consola: "consola", frigider: "frigider", combina: "frigider", aspirator: "aspirator",
  espressor: "espressor", cafetiera: "espressor", friteuza: "friteuza", cuptor: "cuptor", imprimanta: "imprimanta", multifunctionala: "imprimanta",
  router: "router", tastatura: "tastatura", mouse: "mouse", scaun: "scaun", canapea: "canapea", saltea: "saltea", parfum: "parfum",
  trotineta: "trotineta", bicicleta: "bicicleta", anvelopa: "anvelopa", husa: "husa", folie: "husa",
};

/**
 * The kind of product a title names ("telefon", "laptop"...), from its first words, or null when
 * none is recognised. "Produse similare" never shows a laptop next to a phone: a shop category
 * like "Laptop, Tablete & Telefoane" holds both.
 */
export function productKind(title) {
  for (const w of normalizeTitle(title).split(" ").slice(0, 6)) if (KINDS[w]) return KINDS[w];
  return null;
}

/**
 * False when both titles name a kind and the kinds differ. [strict] (the "Produse similare" and
 * "Mai multe de la" rows): once [a]'s kind is known, [b] must name the same kind — a phone's
 * neighbours are phones, not a charger whose title names no kind at all.
 */
export function sameKind(a, b, strict = false) {
  const ka = productKind(a);
  const kb = productKind(b);
  if (strict && ka) return ka === kb;
  return !ka || !kb || ka === kb;
}

const STORAGE = /^(\d+)(gb|tb)$/;
const gigabytes = (w) => Number(w.match(STORAGE)[1]) * (w.endsWith("tb") ? 1024 : 1);

/**
 * What tells the variants of one model apart: storage ("256gb"; the biggest size in the title, a
 * smaller one or the one before "RAM" is the memory) and colour (one name per colour, "black" is
 * "negru"), plus the title without them, which the variants of a model share.
 */
export function variantOf(title) {
  const words = normalizeTitle(title).split(" ").filter(Boolean);
  const sizes = words.filter((w) => STORAGE.test(w));
  const named = sizes.find((w) => words[words.indexOf(w) + 1] === "ram") ?? null;
  const rest = sizes.filter((w) => w !== named).sort((x, y) => gigabytes(y) - gigabytes(x));
  const color = words.find((w) => COLORS.has(w));
  return {
    capacity: rest[0] ?? null,
    ram: named ?? rest[1] ?? null,
    color: color ? sameColor(color) : null,
    base: words.filter((w) => !STORAGE.test(w) && !COLORS.has(w) && w !== "ram").join(" "),
  };
}

/** "256gb" -> "256 GB", "1tb" -> "1 TB". */
export const capacityLabel = (c) => c.replace(STORAGE, (_, n, u) => `${n} ${u.toUpperCase()}`);

/** "negru" -> "Negru", as shown on a colour chip. */
export const colorLabel = (c) => (c === "rosu" ? "Roșu" : c[0].toUpperCase() + c.slice(1));

/** The dot on a colour chip, by colour name; colours without one get a neutral dot. */
export const SWATCH = {
  negru: "#16171A", alb: "#FFFFFF", gri: "#8A8F98", argintiu: "#C9CCD1", auriu: "#D4AF37", albastru: "#2F6FED", rosu: "#E53935",
  verde: "#2E9E5B", galben: "#F5C518", roz: "#F48FB1", mov: "#8E5BD6", portocaliu: "#FF8A00", maro: "#7B4B2A", bej: "#D9C7A3",
  crem: "#F1E7D0", turcoaz: "#1FB5AC", bleumarin: "#1B2A57", grafit: "#3A3D42",
};

/**
 * The other capacities and colours of the product called [title], from catalog rows found by its
 * model ([candidates]: { title, price, ... }). Two lists of { value, current, price, product },
 * cheapest product per value: capacities (in this colour when a shop has it) and the colours of
 * this capacity. A list with nothing to choose from is empty. Same model = same title once
 * capacity and colour are left out; another amount of RAM is another model.
 */
export function variantChoices(title, price, candidates) {
  const own = variantOf(title);
  const family = [];
  for (const c of candidates) {
    const v = variantOf(c.title);
    if (own.ram && v.ram && own.ram !== v.ram) continue;
    if (Boolean(own.capacity) !== Boolean(v.capacity) || Boolean(own.color) !== Boolean(v.color)) continue;
    if (v.capacity === own.capacity && v.color === own.color) continue; // this very product, in another shop
    if (titleSimilarity(own.base, v.base) < SAME_PRODUCT) continue;
    family.push({ ...v, price: c.price, product: c });
  }
  const pick = (field, rows, order) => {
    const best = new Map([[own[field], { value: own[field], current: true, price, product: null }]]);
    for (const r of rows) {
      if (r[field] === own[field]) continue;
      if (!best.has(r[field]) || r.price < best.get(r[field]).price) best.set(r[field], { value: r[field], current: false, price: r.price, product: r.product });
    }
    return best.size > 1 ? [...best.values()].sort(order) : [];
  };
  // Capacities: this colour first, so choosing "512 GB" keeps the colour when a shop has it.
  const inColor = family.filter((r) => r.color === own.color);
  const otherColors = family.filter((r) => r.color !== own.color && !inColor.some((s) => s.capacity === r.capacity));
  return {
    capacities: own.capacity ? pick("capacity", [...inColor, ...otherColors], (x, y) => gigabytes(x.value) - gigabytes(y.value)) : [],
    colors: own.color ? pick("color", family.filter((r) => r.capacity === own.capacity), (x, y) => y.current - x.current || x.price - y.price) : [],
  };
}
