import { test } from "node:test";
import assert from "node:assert/strict";
import { fromProfitshare, readProfitshare } from "../src/profitshare.js";

const sample = {
  link: "https://www.vexio.ro/statii-radio/tti/147584-kit-tti-pack13/?utm=x",
  affiliate_link: "//app.profitshare.ro/lps/zP0/Dhp/?redirect=https%3A%2F%2Fwww.vexio.ro%2F",
  name: "Statie radio  Kit TTI-PACK13",
  image_original: "http://static.profitshare.ro/product_images/photos/50/65/40/50653682.jpeg",
  price_vat: 440.44, price: 364, price_discounted: "",
  brand_name: "TTi", category_name: "Statii Radio", part_number: "TTI-PACK13",
};

test("Profitshare product: VAT price, https links, store from the product URL", () => {
  assert.deepEqual(fromProfitshare(sample), {
    key: "vexio.ro:TTI-PACK13", store: "vexio.ro", title: "Statie radio Kit TTI-PACK13", price: 440.44, oldPrice: null,
    url: "https://www.vexio.ro/statii-radio/tti/147584-kit-tti-pack13/",
    affUrl: "https://app.profitshare.ro/lps/zP0/Dhp/?redirect=https%3A%2F%2Fwww.vexio.ro%2F",
    image: "https://static.profitshare.ro/product_images/photos/50/65/40/50653682.jpeg",
    brand: "TTi", category: "Statii Radio", gtin: null,
  });
  assert.equal(fromProfitshare({ ...sample, price_vat: "" }), null);
});

test("reader pages every advertiser except eMAG", async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    const u = new URL(url);
    if (u.pathname === "/affiliate-advertisers/") return Response.json({ result: { a: { id: 35, name: "eMAG.ro" }, b: { id: 103131, name: "Vexio.ro" } } });
    const page = Number(u.searchParams.get("page"));
    return Response.json({ result: { total_pages: 2, products: [{ ...sample, part_number: `P${page}` }] } });
  };
  const products = await readProfitshare({ PS_API_USER: "u", PS_API_KEY: "k" }, { fetchImpl, log: () => {} });
  assert.deepEqual(products.map((p) => p.key).sort(), ["vexio.ro:P1", "vexio.ro:P2"]);
  assert.ok(!seen.some((u) => u.includes("filters[advertiser]=35")));
});
