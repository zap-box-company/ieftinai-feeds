// Stay inside what Cloudflare Workers Paid ($5/month) includes, so nothing is ever billed on top:
// D1 50M rows written/month and 5 GB storage. Cloudflare has no spending cap, so the import caps itself.
//  - writes: at most NIGHTLY_WRITE_CAP per night (31 nights = 31M), leaving ~19M/month for the
//    prices app users send and for the trending table;
//  - storage: no new products past INSERT_STOP_BYTES, nothing written past WRITE_STOP_BYTES.
export const NIGHTLY_WRITE_CAP = 1_000_000;
export const INSERT_STOP_BYTES = 4 * 1024 ** 3;
export const WRITE_STOP_BYTES = 4.6 * 1024 ** 3;

/** What tonight's import may do, given the requested budget and the database size in bytes. */
export function allowance(requestedBudget, databaseBytes) {
  const budget = Math.min(Math.max(0, Number(requestedBudget) || 0), NIGHTLY_WRITE_CAP);
  if (databaseBytes >= WRITE_STOP_BYTES) return { budget: 0, inserts: false, reason: "database near the 5 GB included storage" };
  if (databaseBytes >= INSERT_STOP_BYTES) return { budget, inserts: false, reason: "database over 4 GB: price updates only" };
  return { budget, inserts: true, reason: null };
}
