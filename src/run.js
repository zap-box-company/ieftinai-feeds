// Nightly import: affiliate feeds -> D1 catalog (only what changed, capped to the Workers Paid included quota: src/quota.js).
// Usage: node src/run.js [--dry-run] [--budget 90000]
// Env: TP_FEED_URL (2Performant CSV), PS_API_USER + PS_API_KEY (Profitshare), CLOUDFLARE_API_TOKEN +
// CLOUDFLARE_ACCOUNT_ID in CI. Each source is optional; at least one must be set.
import { parseCsvObjects, responseText } from "./csv.js";
import { databaseBytes, executeStatements, loadCurrent, recordRun } from "./d1.js";
import { allowance } from "./quota.js";
import { fromTwoPerformant } from "./normalize.js";
import { plan } from "./plan.js";
import { readProfitshare } from "./profitshare.js";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const requested = Number(args[args.indexOf("--budget") + 1]) || 90_000;

const day = Number(
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Bucharest", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date())
    .replace(/-/g, ""),
);

async function readTwoPerformant(url) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`feed HTTP ${response.status}`);
  const byKey = new Map();
  let rows = 0;
  for await (const row of parseCsvObjects(responseText(response))) {
    rows++;
    const product = fromTwoPerformant(row);
    if (product) byKey.set(product.key, product);
  }
  console.log(`2performant: ${rows} rows, ${byKey.size} usable products`);
  return [...byKey.values()];
}

const feedUrl = process.env.TP_FEED_URL;
// Secrets pasted into GitHub may carry spaces, newlines or quotes; Profitshare answers 400 to those.
const secret = (v) => String(v ?? "").trim().replace(/^["']|["']$/g, "");
const psEnv = { PS_API_USER: secret(process.env.PS_API_USER), PS_API_KEY: secret(process.env.PS_API_KEY) };
if (!feedUrl && !psEnv.PS_API_KEY) throw new Error("set TP_FEED_URL and/or PS_API_USER + PS_API_KEY");

const records = [
  ...(feedUrl ? await readTwoPerformant(feedUrl) : []),
  ...(psEnv.PS_API_KEY ? await readProfitshare(psEnv) : []),
];
const current = dryRun ? new Map() : await loadCurrent();
console.log(`catalog currently has ${current.size} products`);

const size = dryRun ? 0 : await databaseBytes();
const { budget, inserts, reason } = allowance(requested, size);
console.log(`database ${(size / 1024 ** 2).toFixed(0)} MB; write budget ${budget}${reason ? ` (${reason})` : ""}`);
const { statements, stats } = plan(records, current, day, budget, { inserts });
console.log(JSON.stringify({ day, budget, ...stats }, null, 2));

if (dryRun) {
  console.log("dry run: nothing written. Sample:\n" + statements.slice(0, 4).join("\n").slice(0, 1500));
} else {
  await executeStatements(statements, fileURLToPath(new URL("../out/", import.meta.url)));
  await recordRun(day, "feeds", stats.seen, stats.estimatedRowsWritten);
  console.log("done");
}
