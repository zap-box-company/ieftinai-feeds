// Decides what to write tonight, within the D1 free-tier write budget, and renders it as SQL.

/** Approximate D1 "rows written" per operation (table row + index entries + FTS + history). */
export const COST = { insert: 6, priceUpdate: 3, metaUpdate: 2 };

const META_FIELDS = ["title", "brand", "url", "image", "gtin", "category"];

/** SQL literal; feed data is untrusted, so every string is escaped. */
export function lit(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error(`non-finite number: ${v}`);
    return String(v);
  }
  return `'${String(v).replace(/\u0000/g, "").replace(/'/g, "''")}'`;
}

/**
 * @param records   normalized feed products (deduplicated by key, last wins)
 * @param current   Map key -> {price, oldPrice, title, brand, url, image, gtin, category} already in D1
 * @param day       yyyymmdd
 * @param budget    max rows written for this run
 */
export function plan(records, current, day, budget) {
  const priceChanges = [];
  const newWithGtin = [];
  const newOther = [];
  const metaChanges = [];

  for (const r of records) {
    const cur = current.get(r.key);
    if (!cur) {
      (r.gtin ? newWithGtin : newOther).push(r);
    } else if (cur.price !== r.price || (cur.oldPrice ?? null) !== (r.oldPrice ?? null)) {
      priceChanges.push({ r, cur });
    } else if (META_FIELDS.some((f) => (cur[f] ?? null) !== (r[f] ?? null))) {
      metaChanges.push(r);
    }
  }

  const statements = [];
  let spent = 0;
  const done = { priceChanges: 0, inserts: 0, metaChanges: 0 };
  const afford = (cost) => spent + cost <= budget;

  for (const { r, cur } of priceChanges) {
    if (!afford(COST.priceUpdate)) break;
    const dropPct = cur.price > 0 ? Math.round(((cur.price - r.price) / cur.price) * 10000) / 100 : null;
    statements.push(
      `UPDATE products SET price=${lit(r.price)}, old_price=${lit(r.oldPrice)}, prev_price=${lit(cur.price)}, ` +
        `drop_pct=${lit(dropPct)}, updated_day=${day} WHERE key=${lit(r.key)};`,
      historyRow(r, day),
    );
    spent += COST.priceUpdate;
    done.priceChanges++;
  }
  for (const r of [...newWithGtin, ...newOther]) {
    if (!afford(COST.insert)) break;
    statements.push(
      "INSERT OR IGNORE INTO products (key, store, title, price, old_price, url, aff_url, image, brand, category, gtin, first_day, updated_day) VALUES (" +
        [r.key, r.store, r.title, r.price, r.oldPrice, r.url, r.affUrl, r.image, r.brand, r.category, r.gtin, day, day].map(lit).join(", ") +
        ");",
      historyRow(r, day),
    );
    spent += COST.insert;
    done.inserts++;
  }
  for (const r of metaChanges) {
    if (!afford(COST.metaUpdate)) break;
    statements.push(
      `UPDATE products SET title=${lit(r.title)}, brand=${lit(r.brand)}, url=${lit(r.url)}, image=${lit(r.image)}, ` +
        `gtin=${lit(r.gtin)}, category=${lit(r.category)}, aff_url=${lit(r.affUrl)} WHERE key=${lit(r.key)};`,
    );
    spent += COST.metaUpdate;
    done.metaChanges++;
  }

  return {
    statements,
    stats: {
      seen: records.length,
      pending: { priceChanges: priceChanges.length, inserts: newWithGtin.length + newOther.length, metaChanges: metaChanges.length },
      done,
      estimatedRowsWritten: spent,
    },
  };
}

function historyRow(r, day) {
  return `INSERT OR REPLACE INTO price_history (key, day, price) VALUES (${lit(r.key)}, ${day}, ${lit(r.price)});`;
}
