// Turns feed rows from different networks into one product shape.

/** "1.299,99" / "1299.99" / "1,299.99" -> 1299.99; null if not a positive number. */
export function parsePrice(raw) {
  if (raw == null) return null;
  let s = String(raw).replace(/[^\d.,]/g, "");
  if (!s) return null;
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? "." : ",";
    s = s.split(dec === "." ? "," : ".").join("").replace(dec, ".");
  } else if (lastComma >= 0) {
    s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

/** Keeps 8/12/13/14-digit codes with a valid GS1 check digit. */
export function normalizeGtin(raw) {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (![8, 12, 13, 14].includes(digits.length)) return null;
  const body = digits.slice(0, -1);
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const d = Number(body[body.length - 1 - i]);
    sum += i % 2 === 0 ? d * 3 : d;
  }
  const check = (10 - (sum % 10)) % 10;
  if (check !== Number(digits.at(-1))) return null;
  return digits.padStart(14, "0"); // one canonical form for EAN-8/UPC/EAN-13
}

/** Feeds sometimes carry HTML entities ("Accesorii &#x3E; Volane", "Tom &amp; Jerry"). */
export function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&(quot|apos|lt|gt|nbsp|amp);/g, (_, n) => ({ quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " ", amp: "&" })[n]);
}

const clean = (s) => {
  const t = decodeEntities(String(s ?? "")).replace(/\s+/g, " ").trim();
  return t || null;
};

const pick = (row, ...names) => {
  for (const n of names) if (row[n] != null && String(row[n]).trim() !== "") return row[n];
  return null;
};

/**
 * 2Performant CSV row -> product. Field names follow the feed's header row; aliases cover the
 * optional fields we enabled (Product URL, GTIN, Brand, Category, Old price, Product ID).
 */
export function fromTwoPerformant(row) {
  const affUrl = pick(row, "aff_code", "marketer link", "affiliate_link");
  const title = clean(pick(row, "title", "product title"));
  const price = parsePrice(pick(row, "price", "sale price"));
  // Program names come as "bazarulonline.ro/ " or "https://www.x.ro": keep the bare domain.
  const store = clean(pick(row, "campaign_name", "merchant program"))?.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
  if (!affUrl || !title || !price || !store) return null;

  const productUnique = /[?&]unique=([^&]+)/.exec(affUrl)?.[1];
  const id = clean(pick(row, "product_id", "product id")) ?? productUnique;
  if (!id) return null;

  const oldPrice = parsePrice(pick(row, "old_price", "old price"));
  const image = clean(String(pick(row, "image_urls", "image urls") ?? "").split(",")[0]);
  return {
    key: `${store}:${id}`,
    store,
    title: title.slice(0, 300),
    price,
    oldPrice: oldPrice && oldPrice > price ? oldPrice : null,
    url: clean(pick(row, "product_url", "product url", "url")),
    affUrl,
    image,
    brand: clean(pick(row, "brand")),
    category: clean(pick(row, "category")),
    gtin: normalizeGtin(pick(row, "gtin", "ean")),
    shipping: null,
  };
}
