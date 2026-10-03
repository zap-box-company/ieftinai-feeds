# PrețAI catalog import

Nightly job: affiliate product feeds → Cloudflare D1 `ieftinai-catalog` (schema in `../server/migrations`).
Only changed prices and new products are written, within the D1 free-tier budget (100k rows/day):
price changes first, then new products with an EAN, then the rest on the following nights.

```sh
npm test                      # parser, normalizer and planner tests
TP_FEED_URL=... npm run dry-run   # parse the feed, print the plan, write nothing
TP_FEED_URL=... npm run import    # write to D1 (uses wrangler: OAuth locally, API token in CI)
```

GitHub Actions secrets: `TP_FEED_URL` (2Performant "IeftinAI" CSV feed), `CLOUDFLARE_API_TOKEN`
(Account → D1 → Edit), `CLOUDFLARE_ACCOUNT_ID`.
