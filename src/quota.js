// Stay inside what Cloudflare Workers Paid ($5/month) includes, so nothing is ever billed on top:
// D1 50M rows written/month and 5 GB storage. Cloudflare has no spending cap, so the import caps itself.
//  - writes: at most NIGHTLY_WRITE_CAP per run, and imports + shop crawler together at most
//    MONTHLY_WRITE_CAP a month (counted in pipeline_runs and crawl_days), leaving 10M for the
//    prices app users send, the trending table and anything not counted;
//  - storage: no new products past INSERT_STOP_BYTES, nothing written past WRITE_STOP_BYTES.
export const NIGHTLY_WRITE_CAP = 4_000_000; // nights ask for 1M; manual catch-up runs up to 4M
export const MONTHLY_WRITE_CAP = 40_000_000;
export const INSERT_STOP_BYTES = 4 * 1024 ** 3;
export const WRITE_STOP_BYTES = 4.6 * 1024 ** 3;

/**
 * What this run may do, given the requested budget, the database size in bytes and the rows
 * already written this month by imports and the crawler.
 */
export function allowance(requestedBudget, databaseBytes, writtenThisMonth = 0) {
  const budget = Math.max(0, Math.min(Number(requestedBudget) || 0, NIGHTLY_WRITE_CAP, MONTHLY_WRITE_CAP - writtenThisMonth));
  if (budget === 0 && writtenThisMonth >= MONTHLY_WRITE_CAP) return { budget: 0, inserts: false, reason: "monthly write cap reached" };
  if (databaseBytes >= WRITE_STOP_BYTES) return { budget: 0, inserts: false, reason: "database near the 5 GB included storage" };
  if (databaseBytes >= INSERT_STOP_BYTES) return { budget, inserts: false, reason: "database over 4 GB: price updates only" };
  return { budget, inserts: true, reason: null };
}
