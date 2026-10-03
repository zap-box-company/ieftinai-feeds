// Rebuilds "Cele mai căutate" (D1 table trending): every seed query is matched against the catalog
// by full-text search and the best real product (not a case or a cable) wins.
// Usage: node src/trending.js [--dry-run]
import { fileURLToPath } from "node:url";
import { executeStatements, queryMany } from "./d1.js";
import { lit } from "./plan.js";
import { rankedQueries } from "./trending-queries.js";

/** First title words (no diacritics) that name an accessory or a game for the product, not the product. */
const ACCESSORY = new Set([
  "husa", "folie", "sticla", "protector", "protectie", "cablu", "incarcator", "adaptor", "carcasa", "suport",
  "curea", "bratara", "geanta", "stand", "skin", "sticker", "toc", "filtru", "sac", "perie", "accesoriu",
  "accesorii", "cartus", "controler", "controller", "joc", "jocuri", "telecomanda", "rezerva",
]);

/** Free text -> FTS5 query where every word must match as a prefix (same rule as the site and the app). */
export function ftsQuery(text) {
  return words(text).slice(0, 8).map((w) => `"${w}"*`).join(" ");
}

/** Lowercase words without diacritics. */
function words(text) {
  return String(text ?? "").normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/**
 * Best candidate among FTS hits (already in relevance order): every query word must be a whole
 * word of the title (FTS matches prefixes: "cuptor" finds "cuptorul" in a steriliser's title),
 * accessories and anything under a third of the median price are skipped, the most relevant wins.
 */
export function pickMatch(rows, query = "") {
  const wanted = words(query);
  const real = rows.filter((r) => {
    // Shops put a game's platform in brackets: "Super Mario Maker 2 (Nintendo Switch)".
    const outside = words(r.title.replace(/\([^)]*\)/g, " "));
    const own = new Set(outside);
    const accessory = ACCESSORY.has(outside[0]) && !wanted.includes(outside[0]);
    return !accessory && wanted.every((w) => own.has(w));
  });
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
    const hit = pickMatch(results[i] ?? [], q.query);
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
