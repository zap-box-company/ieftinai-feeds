// Rebuilds "Cele mai căutate" (D1 table trending): every seed query is matched against the catalog
// by full-text search and the best real product (not a case or a cable) wins.
// Usage: node src/trending.js [--dry-run]
import { fileURLToPath } from "node:url";
import { executeStatements, queryMany } from "./d1.js";
import { lit } from "./plan.js";
import { rankedQueries } from "./trending-queries.js";

/** Accessories that share the product's name ("Husa iPhone 17 Pro") but are not what people search for. */
const ACCESSORY = /^(husa|husă|folie|sticla|sticlă|cablu|incarcator|încărcător|adaptor|carcasa|carcasă|suport|curea|bratara|brățară|geanta|geantă|protectie|protecție|stand|skin|sticker|toc|baterie externa|filtru|sac|perie|accesoriu|set accesorii|cartus|cartuș|husa)\b/i;

/** Free text -> FTS5 query where every word must match as a prefix (same rule as the site and the app). */
export function ftsQuery(text) {
  const words = String(text ?? "").normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return words.slice(0, 8).map((w) => `"${w}"*`).join(" ");
}

/**
 * Best candidate among FTS hits (already in relevance order): skip accessories and anything under
 * a third of the median price (cheap parts that slipped through), then keep the most relevant.
 */
export function pickMatch(rows) {
  const real = rows.filter((r) => !ACCESSORY.test(r.title.trim()));
  if (!real.length) return null;
  const prices = real.map((r) => r.price).sort((a, b) => a - b);
  const median = prices[Math.floor(prices.length / 2)];
  return real.find((r) => r.price >= median / 3) ?? null;
}

export function matchSql(query) {
  return (
    "SELECT p.key, p.title, p.price FROM products_fts f JOIN products p ON p.rowid = f.rowid " +
    `WHERE products_fts MATCH ${lit(ftsQuery(query))} ORDER BY bm25(products_fts) LIMIT 15`
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dryRun = process.argv.includes("--dry-run");
  const queries = rankedQueries();
  const results = await queryMany(queries.map((q) => matchSql(q.query)));
  const now = new Date().toISOString();
  const chosen = [];
  queries.forEach((q, i) => {
    const hit = pickMatch(results[i] ?? []);
    console.log(`${String(q.rank).padStart(3)} ${q.query.padEnd(36)} ${hit ? `${hit.price} lei  ${hit.title.slice(0, 70)}` : "— no match"}`);
    if (hit) chosen.push({ ...q, key: hit.key });
  });
  console.log(`${chosen.length}/${queries.length} matched`);
  if (!dryRun && chosen.length) {
    // Ranks stay contiguous for the readers: matched queries keep their seed order.
    const statements = ["DELETE FROM trending;"].concat(
      chosen.map((c, i) => `INSERT INTO trending (rank, query, key, category, updated_at) VALUES (${i + 1}, ${lit(c.query)}, ${lit(c.key)}, ${lit(c.category)}, ${lit(now)});`),
    );
    await executeStatements(statements, fileURLToPath(new URL("../out/trending/", import.meta.url)));
  }
}
