import { test } from "node:test";
import assert from "node:assert/strict";
import { ftsQuery, matchSql, pickMatch } from "../src/trending.js";
import { rankedQueries } from "../src/trending-queries.js";

test("100 seed queries, varied from the top", () => {
  const q = rankedQueries();
  assert.equal(q.length, 100);
  assert.equal(new Set(q.slice(0, 11).map((x) => x.category)).size, 11);
});

test("accessories and cheap parts lose to the product itself", () => {
  const rows = [
    { key: "a", title: "Husa iPhone 17 Pro, silicon", price: 49 },
    { key: "b", title: "Folie sticla iPhone 17 Pro", price: 29 },
    { key: "c", title: "Cablu iPhone 17 Pro", price: 19 },
    { key: "d", title: "Telefon Apple iPhone 17 Pro 256GB", price: 6399 },
    { key: "e", title: "Telefon Apple iPhone 17 Pro 512GB", price: 7499 },
  ];
  assert.equal(pickMatch(rows, "iphone 17 pro").key, "d");
  assert.equal(pickMatch([{ key: "s", title: "Sterilizator pentru cuptorul cu microunde", price: 137 }], "cuptor cu microunde"), null);
  assert.equal(pickMatch([{ key: "x", title: "Husa", price: 10 }]), null);
});

test("queries are FTS prefix matches with no diacritics and escaped quotes", () => {
  assert.equal(ftsQuery("Mașină de spălat"), '"masina"* "de"* "spalat"*');
  assert.match(matchSql("o'neill"), /MATCH '"o"\* "neill"\*'/);
});

test("games, controllers and screen protectors do not stand in for the console or the watch", () => {
  assert.equal(pickMatch([{ key: "g", title: "Super Mario Maker 2 (Nintendo Switch)", price: 269 }], "nintendo switch 2"), null);
  assert.equal(pickMatch([{ key: "c", title: "Controler Razer - Wolverine V2, Xbox Series X", price: 352 }], "xbox series x"), null);
  assert.equal(pickMatch([{ key: "p", title: "Protector de sticla PanzerGlass, Apple Watch 4/5/6/SE", price: 160 }], "apple watch se"), null);
  assert.equal(pickMatch([{ key: "d", title: "Controller wireless DualSense", price: 369 }], "controller dualsense").key, "d");
});
