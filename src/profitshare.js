// Profitshare product feeds (API affiliate-products, 20 products per page) for every approved
// advertiser. Auth as in the official WP plugin and ../server/src/profitshare.js:
// X-PS-Auth = hex(HMAC-SHA1(method + path + "/?" + query + "/" + apiUser + date, apiKey)).
import { parsePrice } from "./normalize.js";

const API = "https://api.profitshare.ro";

/**
 * Advertisers we never import: eMAG forbids price comparators in its program (and its feed is not
 * offered: HTTP 400); Profitshare itself is not a shop.
 */
export const EXCLUDED_ADVERTISERS = new Set([35, 61861]);

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
      if (res.status === 400 || res.status === 403 || attempt >= 3) throw new Error(`Profitshare via proxy ${path}?${query}: HTTP ${res.status}`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  const date = new Date().toUTCString();
  const auth = await sign(`GET${path}/?${query}/${env.PS_API_USER}${date}`, env.PS_API_KEY);
  for (let attempt = 1; ; attempt++) {
    const res = await fetchImpl(`${API}/${path}/?${query}`, {
      headers: { Date: date, "X-PS-Client": env.PS_API_USER, "X-PS-Accept": "json", "X-PS-Auth": auth },
    });
    if (res.ok) return (await res.json()).result;
    if (res.status === 400 || attempt >= 3) throw new Error(`Profitshare ${path}?${query}: HTTP ${res.status}`);
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
}

const clean = (s) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
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
  };
}

/** Every product of every approved advertiser, a few pages in parallel. */
export async function readProfitshare(env, { concurrency = 4, log = console.log, fetchImpl = fetch } = {}) {
  const advertisers = Object.values(await call(env, "affiliate-advertisers", "", fetchImpl)).filter((a) => !EXCLUDED_ADVERTISERS.has(Number(a.id)));
  const byKey = new Map();
  for (const a of advertisers) {
    let first;
    try {
      first = await call(env, "affiliate-products", `filters[advertiser]=${a.id}&page=1`, fetchImpl);
    } catch (error) {
      log(`profitshare: ${a.name} skipped (${error.message})`);
      continue;
    }
    const pages = Number(first.total_pages) || 0;
    const add = (r) => (r?.products ?? []).forEach((p) => { const x = fromProfitshare(p); if (x) byKey.set(x.key, x); });
    add(first);
    let next = 2;
    const worker = async () => {
      while (next <= pages) {
        const page = next++;
        try {
          add(await call(env, "affiliate-products", `filters[advertiser]=${a.id}&page=${page}`, fetchImpl));
        } catch (error) {
          log(`profitshare: ${a.name} page ${page} failed (${error.message})`);
        }
      }
    };
    await Promise.all(Array.from({ length: concurrency }, worker));
    log(`profitshare: ${a.name} ${pages} pages`);
  }
  log(`profitshare: ${byKey.size} usable products`);
  return [...byKey.values()];
}
