// Profitshare product feeds (API affiliate-products, 20 products per page) for every approved
// advertiser. Auth as in the official WP plugin and ../server/src/profitshare.js:
// X-PS-Auth = hex(HMAC-SHA1(method + path + "/?" + query + "/" + apiUser + date, apiKey)).
import { decodeEntities, parsePrice } from "./normalize.js";
import { normalizeMpn } from "./match.js";

const API = "https://api.profitshare.ro";
const RETRIES = 6;
const BACKOFF_MS = 3000;

/**
 * Advertisers we never import because their program terms forbid price comparators / price
 * history sites and apps (checked on their Profitshare program pages, 2026-10-03): eMAG (35) and
 * Fashion Days (88736). Profitshare itself (61861) is not a shop.
 */
export const EXCLUDED_ADVERTISERS = new Set([35, 88736, 61861]);

async function sign(message, key) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Same token as ../server/src/feedproxy.js: hex HMAC-SHA256(PS_API_KEY, "pipeline:" + UTC day). */
export async function pipelineToken(key, date = new Date()) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`pipeline:${date.toISOString().slice(0, 10)}`));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * One Profitshare API call. With env.PS_PROXY_URL it goes through our Worker (Profitshare refuses
 * GitHub's servers with HTTP 400); otherwise straight to the API (works from a home connection).
 */
export async function call(env, path, query = "", fetchImpl = fetch) {
  if (env.PS_PROXY_URL) {
    const token = await pipelineToken(env.PS_API_KEY);
    for (let attempt = 1; ; attempt++) {
      const res = await fetchImpl(`${env.PS_PROXY_URL.replace(/\/+$/, "")}/v1/ps/${path}?${query}`, { headers: { "X-Pipeline-Token": token } });
      if (res.ok) return (await res.json()).result;
      if (res.status === 400 || res.status === 403 || attempt >= RETRIES) throw new Error(`Profitshare via proxy ${path}?${query}: HTTP ${res.status}`);
      await new Promise((r) => setTimeout(r, BACKOFF_MS * attempt));
    }
  }
  const date = new Date().toUTCString();
  const auth = await sign(`GET${path}/?${query}/${env.PS_API_USER}${date}`, env.PS_API_KEY);
  for (let attempt = 1; ; attempt++) {
    const res = await fetchImpl(`${API}/${path}/?${query}`, {
      headers: { Date: date, "X-PS-Client": env.PS_API_USER, "X-PS-Accept": "json", "X-PS-Auth": auth },
    });
    if (res.ok) return (await res.json()).result;
    if (res.status === 400 || attempt >= RETRIES) throw new Error(`Profitshare ${path}?${query}: HTTP ${res.status}`);
    await new Promise((r) => setTimeout(r, BACKOFF_MS * attempt));
  }
}

const clean = (s) => {
  const t = decodeEntities(String(s ?? "")).replace(/\s+/g, " ").trim();
  return t || null;
};

/** Profitshare product -> catalog product. Prices: `price_vat` is what the shop shows (VAT included). */
export function fromProfitshare(p) {
  let url;
  try {
    url = new URL(p.link);
  } catch {
    return null;
  }
  const title = clean(p.name);
  const price = parsePrice(p.price_vat);
  if (!title || !price || !p.affiliate_link) return null;
  const store = url.hostname.toLowerCase().replace(/^www\./, "");
  const id = clean(p.part_number) ?? url.pathname.replace(/\/+$/, "");
  const image = clean(p.image_original ?? p.image)?.replace(/^http:\/\//, "https://") ?? null;
  return {
    key: `${store}:${id}`.slice(0, 300),
    store,
    title: title.slice(0, 300),
    price,
    oldPrice: null,
    url: `${url.origin}${url.pathname}`,
    affUrl: p.affiliate_link.startsWith("//") ? `https:${p.affiliate_link}` : p.affiliate_link,
    image,
    brand: clean(p.brand_name),
    category: clean(p.category_name),
    gtin: null,
    // Profitshare has no EAN; part_number is often the manufacturer's code (SM-S948BZKDEUE).
    mpn: normalizeMpn(p.part_number),
    // Feed flag only: free delivery is 0; otherwise the cost is unknown (null), never guessed.
    shipping: Number(p.free_shipping) === 1 ? 0 : null,
  };
}

/**
 * Splits advertisers into [parts] groups of about the same number of pages (biggest first, each to
 * the lightest group); deterministic, so every advertiser is refreshed once every [parts] nights.
 */
export function rotationGroups(advertisers, parts) {
  const groups = Array.from({ length: parts }, () => ({ pages: 0, ids: new Set() }));
  for (const a of [...advertisers].sort((x, y) => y.pages - x.pages || Number(x.id) - Number(y.id))) {
    const g = groups.reduce((min, g) => (g.pages < min.pages ? g : min));
    g.pages += a.pages;
    g.ids.add(String(a.id));
  }
  return groups.map((g) => g.ids);
}

/**
 * Products of the approved advertisers, a few pages in parallel; pages that still fail get a second,
 * slower pass at the end (Profitshare answers 502 when busy). Page 1 of every advertiser is read each
 * night; the remaining pages only for tonight's rotation group (rotation: { parts, index }), which
 * keeps the run inside GitHub's free Actions minutes. Products not read tonight keep their last price.
 */
export async function readProfitshare(env, { concurrency = 4, log = console.log, fetchImpl = fetch, rotation = { parts: 1, index: 0 } } = {}) {
  const advertisers = Object.values(await call(env, "affiliate-advertisers", "", fetchImpl)).filter((a) => !EXCLUDED_ADVERTISERS.has(Number(a.id)));
  const byKey = new Map();
  const add = (r) => (r?.products ?? []).forEach((p) => { const x = fromProfitshare(p); if (x) byKey.set(x.key, x); });
  const known = [];
  for (const a of advertisers) {
    try {
      const first = await call(env, "affiliate-products", `filters[advertiser]=${a.id}&page=1`, fetchImpl);
      add(first);
      known.push({ ...a, pages: Number(first.total_pages) || 0 });
    } catch (error) {
      log(`profitshare: ${a.name} skipped (${error.message})`);
    }
  }
  const parts = Math.max(1, rotation.parts);
  const tonight = rotationGroups(known, parts)[((rotation.index % parts) + parts) % parts];
  for (const a of known) {
    if (!tonight.has(String(a.id))) continue;
    const failed = [];
    const run = async (list, parallel, final) => {
      let i = 0;
      const worker = async () => {
        while (i < list.length) {
          const page = list[i++];
          try {
            add(await call(env, "affiliate-products", `filters[advertiser]=${a.id}&page=${page}`, fetchImpl));
          } catch (error) {
            if (final) log(`profitshare: ${a.name} page ${page} failed (${error.message})`);
            else failed.push(page);
          }
        }
      };
      await Promise.all(Array.from({ length: parallel }, worker));
    };
    await run(Array.from({ length: Math.max(0, a.pages - 1) }, (_, k) => k + 2), concurrency, false);
    if (failed.length) await run(failed, 1, true);
    log(`profitshare: ${a.name} ${a.pages} pages, ${failed.length} retried`);
  }
  log(`profitshare: group ${(rotation.index % parts) + 1}/${parts} tonight, ${byKey.size} usable products`);
  return [...byKey.values()];
}
