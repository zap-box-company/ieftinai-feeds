import { test } from "node:test";
import assert from "node:assert/strict";
import { EMAG_TREE, mapCategory, stems } from "../src/categories.js";

test("eMAG tree: 12 departments, every category under a group", () => {
  assert.equal(EMAG_TREE.length, 12);
  assert.ok(EMAG_TREE.every((d) => d.groups.every((g) => g.categories.length > 0)));
});

test("shop categories land in the right eMAG category", () => {
  assert.equal(mapCategory("Monitoare").slug, "monitoare-lcd-led");
  assert.equal(mapCategory("Puzzle-uri clasice").slug, "puzzle");
  assert.equal(mapCategory("Constructori").slug, "seturi-constructie");
  assert.equal(mapCategory("Constructori").dept, "jucarii-copii-bebe");
  assert.equal(mapCategory("Figurine > Funko").slug, "figurine");
  assert.equal(mapCategory("Desktop PC").dept, "pc-periferice-software");
  assert.notEqual(mapCategory("Unelte electrice")?.slug, "trotinete-electrice");
});

test("stems drop diacritics and stopwords", () => {
  assert.deepEqual(stems("Cărți pentru copii"), ["carti", "copii"]);
});

test("garden furniture is not a phone; phones and shampoos still map", () => {
  assert.notEqual(mapCategory("Mobilier de grădină")?.slug, "telefoane-mobile");
  assert.equal(mapCategory("Smartphone-uri").slug, "telefoane-mobile");
  assert.equal(mapCategory("Telefoane").slug, "telefoane-mobile");
  assert.equal(mapCategory("Mobilier"), null);
});

test("an accessories category never lands in the main product", () => {
  assert.equal(mapCategory("Accesorii Telefoane Mobile").slug, "alte-accesorii-telefoane");
  assert.notEqual(mapCategory("Accesorii laptop")?.slug, "laptopuri");
});
