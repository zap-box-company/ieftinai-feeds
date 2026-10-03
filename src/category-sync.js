// Rebuilds the category_map table: every shop category in the catalog, mapped onto eMAG's tree.
// Runs after each import (and by hand: npm run categories). ~5k rows, rewritten only when changed.
import { fileURLToPath } from "node:url";
import { executeStatements, queryMany } from "./d1.js";
import { mapCategory } from "./categories.js";
import { lit } from "./plan.js";

export async function syncCategories({ log = console.log } = {}) {
  const [counts, current] = await queryMany([
    "SELECT category, COUNT(*) AS n FROM products WHERE category IS NOT NULL GROUP BY category",
    "SELECT feed_category, emag_slug, products FROM category_map",
  ]);
  const before = new Map(current.map((r) => [r.feed_category, r]));
  const statements = [];
  let mapped = 0;
  let covered = 0;
  for (const { category, n } of counts) {
    const m = mapCategory(category);
    if (!m) continue;
    mapped++;
    covered += n;
    const old = before.get(category);
    if (old && old.emag_slug === m.slug && old.products === n) continue;
    statements.push(
      `INSERT INTO category_map (feed_category, emag_slug, dept, products) VALUES (${lit(category)}, ${lit(m.slug)}, ${lit(m.dept)}, ${n}) ` +
        `ON CONFLICT (feed_category) DO UPDATE SET emag_slug = excluded.emag_slug, dept = excluded.dept, products = excluded.products;`,
    );
  }
  const total = counts.reduce((a, r) => a + r.n, 0);
  log(`categories: ${mapped}/${counts.length} shop categories mapped, ${covered}/${total} products; ${statements.length} rows to write`);
  if (statements.length) await executeStatements(statements, fileURLToPath(new URL("../out/categories/", import.meta.url)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await syncCategories();
