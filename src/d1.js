// D1 access through the pinned local wrangler, run without a shell so SQL arguments stay intact (OAuth locally, CLOUDFLARE_API_TOKEN in GitHub Actions).
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const DB = "ieftinai-catalog";
const CONFIG = fileURLToPath(new URL("../wrangler.toml", import.meta.url));
const WRANGLER = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));

async function wrangler(args) {
  const { stdout } = await run(process.execPath, [WRANGLER, ...args, "--config", CONFIG], {
    maxBuffer: 512 * 1024 * 1024,
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  });
  return stdout;
}

async function query(sql) {
  const out = await wrangler(["d1", "execute", DB, "--remote", "--json", "--command", sql]);
  const parsed = JSON.parse(out.slice(out.indexOf("[")));
  return parsed[0]?.results ?? [];
}

/** Current database size in bytes (wrangler d1 info). */
export async function databaseBytes() {
  const out = await wrangler(["d1", "info", DB, "--json"]);
  return Number(JSON.parse(out.slice(out.indexOf("{"))).database_size) || 0;
}

/** Several SELECTs in one wrangler call; one result array per statement, in order. */
export async function queryMany(sqls) {
  const out = await wrangler(["d1", "execute", DB, "--remote", "--json", "--command", sqls.join(";\n")]);
  return JSON.parse(out.slice(out.indexOf("["))).map((r) => r.results ?? []);
}

/** All products currently in D1, keyed by product key (paged by key to keep responses small). */
export async function loadCurrent() {
  const current = new Map();
  let after = "";
  for (;;) {
    const rows = await query(
      "SELECT key, price, old_price, title, brand, url, image, gtin, category, shipping FROM products " +
        `WHERE key > '${after.replace(/'/g, "''")}' ORDER BY key LIMIT 20000`,
    );
    for (const r of rows) {
      current.set(r.key, {
        price: r.price, oldPrice: r.old_price, title: r.title, brand: r.brand,
        url: r.url, image: r.image, gtin: r.gtin, category: r.category, shipping: r.shipping,
      });
    }
    if (rows.length < 20000) return current;
    after = rows.at(-1).key;
  }
}

/** Writes statements in files of [perFile] and executes them (wrangler uses D1's bulk import). */
export async function executeStatements(statements, outDir, perFile = 20000) {
  await mkdir(outDir, { recursive: true });
  for (let i = 0; i < statements.length; i += perFile) {
    const file = join(outDir, `batch-${String(i / perFile + 1).padStart(3, "0")}.sql`);
    await writeFile(file, statements.slice(i, i + perFile).join("\n") + "\n", "utf8");
    await wrangler(["d1", "execute", DB, "--remote", "--yes", "--file", file]);
    console.log(`executed ${file}`);
  }
}

export async function recordRun(day, source, seen, written) {
  await query(
    `INSERT OR REPLACE INTO pipeline_runs (day, source, rows_seen, rows_written, finished_at) ` +
      `VALUES (${day}, '${source}', ${seen}, ${written}, '${new Date().toISOString()}')`,
  );
}
