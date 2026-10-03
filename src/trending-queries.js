// Seed for "Cele mai căutate": products Romanians search for most, by group (October 2026,
// editorial list until app interest data takes over). Each query must find its product by title.
export const TRENDING_QUERIES = [
  ["Telefoane", ["iphone 17 pro max", "iphone 17 pro", "iphone 17", "iphone 16", "iphone 15", "samsung galaxy s25 ultra", "samsung galaxy s25", "samsung galaxy a56", "samsung galaxy a36", "samsung galaxy a16", "xiaomi redmi note 14", "xiaomi 15", "google pixel 10", "motorola edge 60", "samsung galaxy z flip7", "oneplus 13", "honor 400"]],
  ["Laptopuri", ["macbook air m4", "macbook pro m4", "lenovo ideapad slim 3", "lenovo legion 5", "asus vivobook 15", "asus tuf gaming f15", "hp victus 15", "acer nitro v 15", "dell inspiron 15", "lenovo loq"]],
  ["Tablete și ceasuri", ["ipad air", "ipad 11", "samsung galaxy tab s10", "samsung galaxy tab a9", "apple watch series 11", "apple watch se", "samsung galaxy watch8", "xiaomi smart band 9"]],
  ["Televizoare", ["televizor samsung 55", "televizor lg oled", "televizor samsung qled 65", "televizor tcl 55", "televizor philips ambilight", "televizor sony bravia", "televizor hisense 50"]],
  ["Gaming", ["playstation 5 slim", "playstation 5 pro", "nintendo switch 2", "xbox series x", "controller dualsense", "ea sports fc 26", "steam deck", "placa video rtx 5070", "placa video rtx 5060", "procesor amd ryzen 7 9800x3d"]],
  ["Audio", ["airpods pro 3", "airpods 4", "samsung galaxy buds3 pro", "sony wh-1000xm6", "jbl tune 520bt", "jbl charge 5", "jbl flip 6", "marshall emberton"]],
  ["Electrocasnice mari", ["masina de spalat rufe beko", "masina de spalat rufe samsung", "frigider samsung", "combina frigorifica bosch", "masina de spalat vase bosch", "uscator de rufe", "aer conditionat daikin", "cuptor incorporabil"]],
  ["Electrocasnice mici", ["friteuza cu aer cald philips", "friteuza cu aer cald ninja", "friteuza cu aer cald cosori", "espressor de lusso", "espressor philips 2200", "aspirator robot roborock", "aspirator dyson", "aspirator vertical xiaomi", "robot de bucatarie", "blender nutribullet", "cuptor cu microunde"]],
  ["Îngrijire personală", ["dyson airwrap", "placa de par", "periuta de dinti electrica oral-b", "aparat de ras philips", "epilator braun", "parfum dior sauvage", "parfum chanel coco mademoiselle"]],
  ["Jucării", ["lego technic", "lego star wars", "lego city", "lego friends", "barbie", "hot wheels", "trotineta electrica xiaomi", "bicicleta copii"]],
  ["Casă și unelte", ["masina de gaurit bosch", "aparat de spalat cu presiune karcher", "router wifi tp-link", "camera supraveghere wifi", "boxa inteligenta", "bec inteligent"]],
];

/** Ranked list [{rank, query, category}]: the first of every group, then the seconds..., so any top N is varied. */
export function rankedQueries() {
  const longest = Math.max(...TRENDING_QUERIES.map(([, q]) => q.length));
  const out = [];
  for (let i = 0; i < longest; i++) {
    for (const [category, queries] of TRENDING_QUERIES) if (queries[i]) out.push({ rank: out.length + 1, query: queries[i], category });
  }
  return out;
}
