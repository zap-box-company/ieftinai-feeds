// Tells IndexNow (Bing, Yandex, Seznam, Naver...) which pages of pretai.ro to read: every address
// in the site's pages sitemap (home, departments, categories, brands, the drops and Black Friday
// pages), once per import. Google does not use IndexNow; it reads the sitemaps.
// Usage: node src/indexnow.js [--dry-run]
const ORIGIN = "https://pretai.ro";
const KEY = "f71373e8c13f250af820bbe3d3352fe8"; // public by design: the site serves it at /<key>.txt (web/wrangler.toml)

/** The addresses listed in a sitemap file. */
export function locsOf(xml) {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, "&"));
}

if (process.argv[1]?.endsWith("indexnow.js")) {
  const res = await fetch(`${ORIGIN}/sitemaps/pages.xml`);
  if (!res.ok) throw new Error(`sitemap HTTP ${res.status}`);
  const urlList = locsOf(await res.text()).filter((u) => u.startsWith(ORIGIN)).slice(0, 10_000);
  console.log(`indexnow: ${urlList.length} pages`);
  if (!process.argv.includes("--dry-run") && urlList.length) {
    const sent = await fetch("https://api.indexnow.org/indexnow", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ host: "pretai.ro", key: KEY, keyLocation: `${ORIGIN}/${KEY}.txt`, urlList }),
    });
    console.log(`indexnow: HTTP ${sent.status}`);
  }
}
