import { test } from "node:test";
import assert from "node:assert/strict";
import { allowance, MONTHLY_WRITE_CAP, NIGHTLY_WRITE_CAP } from "../src/quota.js";
import { plan } from "../src/plan.js";

const GB = 1024 ** 3;

test("the nightly budget never exceeds the included-quota cap", () => {
  assert.equal(allowance(9_000_000, 1 * GB).budget, NIGHTLY_WRITE_CAP);
  assert.ok(MONTHLY_WRITE_CAP + 10_000_000 <= 50_000_000); // 10M left for the app and the rest
  assert.deepEqual(allowance(90_000, 0.01 * GB), { budget: 90_000, inserts: true, reason: null });
});

test("storage: price updates only past 4 GB, nothing past 4.6 GB", () => {
  assert.equal(allowance(1e6, 4.2 * GB).inserts, false);
  assert.equal(allowance(1e6, 4.2 * GB).budget, 1e6);
  assert.equal(allowance(1e6, 4.7 * GB).budget, 0);
});

test("plan with inserts off only updates known products", () => {
  const mk = (key, price) => ({ key, store: "s", title: key, price, oldPrice: null, url: null, affUrl: "a", image: null, brand: null, category: null, gtin: null });
  const current = new Map([["s:1", { price: 100, oldPrice: null, title: "s:1", brand: null, url: null, image: null, gtin: null, category: null }]]);
  const r = plan([mk("s:1", 90), mk("s:new", 5)], current, 20261004, 1000, { inserts: false });
  assert.deepEqual(r.stats.done, { priceChanges: 1, inserts: 0, metaChanges: 0 });
});

test("the month's writes stop at the monthly cap", () => {
  assert.equal(allowance(4e6, 1 * GB, MONTHLY_WRITE_CAP - 1e6).budget, 1e6);
  assert.deepEqual(allowance(1e6, 1 * GB, MONTHLY_WRITE_CAP), { budget: 0, inserts: false, reason: "monthly write cap reached" });
});
