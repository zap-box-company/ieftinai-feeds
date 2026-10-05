// Nightly import: affiliate feeds -> D1 catalog (only what changed, capped to the Workers Paid included quota: src/quota.js).
// Usage: node src/run.js [--dry-run] [--budget 90000]
// Env: TP_FEED_URL (2Performant CSV), PS_API_USER + PS_API_KEY (Profitshare), CLOUDFLARE_API_TOKEN +
// CLOUDFLARE_ACCOUNT_ID in CI. Each source is optional; at least one must be set.
import { parseCsvObjects, responseText } from "./csv.js";
import { databaseBytes, executeStatements, loadCurrent, recordRun, writtenThisMonth } from "./d1.js";
import { allowance } from "./quota.js";
import { feedUrlsFrom, fromTwoPerformant } from "./normalize.js";
import { metaSig, plan } from "./plan.js";
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

/** Products written per batch (user: every 5,000): a run that stops early keeps all but the last batch. */
const BATCH = 5_000;

/**
 * A 2Performant feed is generated on the first request of the day: that request can answer 504
 * after 30 s while the file is being built and the next one, a minute later, gets it at once
 * (seen 2026-10-05 on feeds with many programs). A download can also drop mid-stream. So: try
 * again a few times, then go on without that feed rather than lose the night's import.
 */
async function readTwoPerformantSafely(url, onBatch, attempts = 4) {
  for (let i = 1; i <= attempts; i++) {
    try {
      return await readTwoPerformant(url, onBatch);
    } catch (error) {
      console.log(`2performant: attempt ${i}/${attempts} failed (${error.cause?.message ?? error.message})`);
      if (i < attempts) await new Promise((r) => setTimeout(r, 60_000 * i));
    }
  }
  console.log("2performant: skipped tonight; Profitshare goes on");
}

/** Streams the feed; [onBatch] gets every BATCH new products and may answer false to stop early. */
async function readTwoPerformant(url, onBatch) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`feed HTTP ${response.status}`);
  const seen = new Set();
  let batch = [];
  let rows = 0;
  for await (const row of parseCsvObjects(responseText(response))) {
    rows++;
    const product = fromTwoPerformant(row);
    if (!product || seen.has(product.key)) continue;
    seen.add(product.key);
    batch.push(product);
    if (batch.length >= BATCH) {
      const go = await onBatch(batch);
      batch = [];
      if (go === false) { console.log(`2performant: budget used up after ${rows} rows`); return; }
    }
  }
  if (batch.length) await onBatch(batch);
  console.log(`2performant: ${rows} rows, ${seen.size} usable products`);
}

// One or more 2Performant CSV links (space, comma or newline separated). The single 300-program
// feed is generated live and 2Performant closes the connection after 60 s, so it is split into
// smaller feeds, each read in turn.
const feedUrls = feedUrlsFrom(process.env.TP_FEED_URL, process.env.TP_FEED_URLS);
console.log(`2performant: ${feedUrls.length} feed link(s) configured`);
const feedUrl = feedUrls[0];
// Secrets pasted into GitHub may carry spaces, newlines or quotes; Profitshare answers 400 to those.
const secret = (v) => String(v ?? "").trim().replace(/^["']|["']$/g, "");
const psEnv = { PS_API_USER: secret(process.env.PS_API_USER), PS_API_KEY: secret(process.env.PS_API_KEY), PS_PROXY_URL: process.env.PS_PROXY_URL };
if (psEnv.PS_API_KEY) console.log(`profitshare credentials: user ${psEnv.PS_API_USER.length} chars, key ${psEnv.PS_API_KEY.length} chars`);
if (!feedUrl && !psEnv.PS_API_KEY) throw new Error("set TP_FEED_URL and/or PS_API_USER + PS_API_KEY");

// Profitshare first (user, 2026-10-04), and written as soon as it is read: a run that later runs
// out of time on the 2M-row 2Performant feed keeps what it already imported.
const current = dryRun ? new Map() : await loadCurrent();
console.log(`catalog currently has ${current.size} products`);
const size = dryRun ? 0 : await databaseBytes();
const used = dryRun ? 0 : await writtenThisMonth(day);
const { budget, inserts, reason } = allowance(requested, size, used);
console.log(`written this month so far: ${used}`);
console.log(`database ${(size / 1024 ** 2).toFixed(0)} MB; write budget ${budget}${reason ? ` (${reason})` : ""}`);
let left = budget;

/** Plans and writes one source's records within what is left of the budget. */
async function importStage(name, records, outDir) {
  const { statements, stats, written } = plan(records, current, day, left, { inserts });
  console.log(JSON.stringify({ stage: name, day, budget: left, ...stats }, null, 2));
  if (dryRun) {
    console.log("dry run: nothing written. Sample:\n" + statements.slice(0, 4).join("\n").slice(0, 1500));
    return;
  }
  try {
    await executeStatements(statements, fileURLToPath(new URL(outDir, import.meta.url)));
  } catch (error) {
    // One batch that keeps failing is skipped; the next ones still land (it comes back next run).
    console.log(`${name}: batch not written (${String(error.message).slice(0, 200)}); going on`);
    return;
  }
  await recordRun(day, "feeds", stats.seen, stats.estimatedRowsWritten);
  left -= stats.estimatedRowsWritten;
  // Later batches see these as known (no double insert when the feed lists a product twice).
  for (const w of written) current.set(w.key, { price: w.price, oldPrice: w.oldPrice ?? null, sig: metaSig(w) });
  console.log(`${name}: written, ${left} rows left in the budget`);
}

if (psEnv.PS_API_KEY) {
  // A third of the Profitshare shops in full each night (PS_ROTATION_PARTS=1 reads them all).
  await readProfitshare(psEnv, {
    rotation: { parts: Number(process.env.PS_ROTATION_PARTS || 3), index: Math.floor(Date.UTC(Math.floor(day / 10000), Math.floor(day / 100) % 100 - 1, day % 100) / 86_400_000) },
    batchSize: BATCH,
    onBatch: (list) => importStage("profitshare", list, "../out/profitshare/"),
  });
}
for (const [i, url] of feedUrls.entries()) {
  if (left <= 0) break;
  console.log(`2performant: feed ${i + 1}/${feedUrls.length}`);
  await readTwoPerformantSafely(url, async (list) => {
    await importStage("2performant", list, "../out/2performant/");
    return left > 0;
  });
}
console.log("done");
