// Products the catalog does not list (user, 2026-10-06, for the Google Play declaration): alcohol,
// tobacco and vaping, products for adults, weapons. Shops that sell mostly these are left out whole;
// in the general shops only the rows are. The pipeline has a copy of this file (pipeline/src).

/** Shops left out whole, by name: what the catalog had of them on 2026-10-06. */
const SHOPS = new Set([
  "parmashop.ro", "bauturialcoolice.ro", "alcooldiscount.ro", "vinimediat.ro", "vinregal.ro", "club-unvinpezi.ro", // drinks
  "e-potion.ro", // vaping
  "sabora.ro", "zelto.ro", "diblongromania.ro", // adult
  "waragod.ro", // stun guns, batons
]);

/** ...and by what the domain says, for the shops the crawler meets later. */
const SHOP_WORDS = /(^|[.-])(vin|vinuri|vinul|crama|arme)([.-]|$)|wine|alcool|bauturi|whisky|spirits|(^|[.-])vap(e|ing)|vapeshop|tigar|tutun|trabuc|narghil|sexshop|sex-shop|erotic|adultshop|airsoft|cbd|canabis|cannabis|pariuri|casino|cazino/;

export function restrictedShop(domain) {
  const d = String(domain ?? "").toLowerCase().replace(/^www\./, "");
  return SHOPS.has(d) || SHOP_WORDS.test(d.replace(/\.(ro|com|eu|net|shop|store)$/, ""));
}

const plain = (s) => String(s ?? "").normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase();

const DRINK = /\b(whisky|whiskey|bourbon|vodka|votca|gin|rom|rum|tequila|cognac|coniac|brandy|lichior|vin|vinuri|sampanie|prosecco|palinca|tuica|rachiu|bere|vermut)\b/;
/**
 * "Spumant" is a sparkling wine only next to a wine word: alone it is a foaming soap or bath gel.
 * "Bitter" and "aperitiv" are left to the strength rule ("32% vol"): most are herbal tinctures and snacks.
 */
const SPARKLING = /\bspumant\b.*\b(brut|sec|demisec|demidulce|dulce|rose|alb)\b|\b(brut|demisec|demidulce)\b.*\bspumant\b/;
const DRINK_SIZE = /\b0[.,]\d{1,3} ?l\b|\b[1-3]([.,]\d)? ?l\b|\b\d{2,3} ?cl\b|\b(200|350|500|700|750|1000|1500) ?ml\b/;
const DRINK_STRENGTH = /\b\d{1,2}([.,]\d)? ?% ?(alc|vol)|\balc\.? ?\d{1,2}([.,]\d)? ?%/;
/** Things named after a drink that are not one: glasses, a sofa in "vin roșu", a book about whisky. */
const NOT_DRINK = /\b(pahar|pahare|cupa|cupe|decantor|carafa|canuta|halba|suport|raft|dop|dopuri|tirbuson|desfacator|butoi|aschii|eticheta|etichete|parfum|apa de (parfum|toaleta)|lumanare|odorizant|esenta|aroma|sirop|otet|sos|ceai|cafea|ciocolata|bomboane|carte|paperback|hardcover|audiobook|vopsea|lac|sampon|deodorant|gel de dus|crema|termos|sticla|sticle|palnie|set de whisky|fungicid|insecticid|erbicid|ingrasamant|canapea|fotoliu|scaun|rochie|bluza|geanta|pantofi|cizme|ruj|oja|gel|baie|curatare|purifiant|demachiant|tinctura|plante|ierburi|ierburile|cesti|ulcior|flacon|punga|aditiv|porumb|sapun|dozator|pet|email|oxidant|oxidanta|lotiune|joc|aparat|presa|dioxid|conservant|dispenser|malt|kit|drojdie|fara alcool|0[.,]0 ?%|0 ?% alcool)\b/;

const TOBACCO = /\b(tigari|tigarete|tigara electronica|tigari electronice|vape|vaping|tutun|trabuc|trabucuri|narghilea|narghilele|iqos|heets|glo hyper|nicotina|snus|e-?lichid|lichid tigara)\b/;
/** "Tutun" is also a colour and a scent; "țigări" is in book titles. */
const NOT_TOBACCO = /\b(lumanare|parfum|apa de (parfum|toaleta)|odorizant|cant|nuc|pal|blat|vopsea|carte|paperback|hardcover|bomboane|insecticid|fungicid|erbicid|culoare|indicator|semn|placuta|autocolant|sticker|quit)\b/;

/** "Bernardo BDSM 150" is a belt sander; "Color Fetish" is a lipstick; "penis de vită" is a dog treat. */
const SANDER = /bernardo|slefuit|\b(ruj|fard|machiaj|paleta|caini|caine|recompensa|vitel|vita)\b/;
const ADULT = /\b(dildo|masturbator|bdsm|fetish|sex ?shop|jucari[ei] erotic[ae]|papusa gonflabila|afrodisiac\w*|erectie|erectii|erectila|ejacul\w*|potentei|penis\w*|vulva|clitoris\w*|spanish fly|lubrifiant intim|gel intim pentru barbati|spray intim|durex play|inel vibrator)\b/;
const VIBRATOR = /\bvibrator\b/;
/** Concrete vibrators, tile vibrators and massage chairs are tools. */
const TOOL = /\b(beton|placi|ceramic\w*|lance|furtun|ax flexibil|ventuza|masaj|acumulator pentru|sita|compactor|motor|frecventa|technoflex|zgarda)\b/;

const WEAPON = /\b(electrosoc\w*|spray (paralizant|de autoaparare|autoaparare|cu piper|piper)|baston telescopic esp|airsoft|pistol cu bile|pusca cu aer comprimat|arma cu aer comprimat|carabina cu aer|box metalic|rozeta autoaparare)\b/;
const TOY = /\b(jucarie|jucarii|copii|puzzle|figurina|lego|costum|carnaval|zgarda|anti-?latrat|animale|vite|kerbl|gard electric|statie|emisie)\b/;

/** True for a title of one of the product kinds above. */
export function restrictedTitle(title) {
  const t = plain(title);
  // "40% alc" is a drink; "0% alcool" says it is not one.
  if (DRINK_STRENGTH.test(t) && !/\b0([.,]0)? ?% ?(alc|vol)/.test(t)) return true;
  if ((DRINK.test(t) || SPARKLING.test(t)) && DRINK_SIZE.test(t) && !NOT_DRINK.test(t)) return true;
  // Wine and beer in bulk ("Vin ... bag in box 10 L"); for the other words a big size is something
  // else ("128GB ROM ... Yeti 5L", a 20 L vacuum cleaner "RUM-20").
  if (/\b(vin|vinuri|bere)\b/.test(t) && /\b([4-9]|1\d|20) ?l\b/.test(t) && !NOT_DRINK.test(t)) return true;
  if (TOBACCO.test(t) && !NOT_TOBACCO.test(t)) return true;
  if ((ADULT.test(t) && !SANDER.test(t)) || (VIBRATOR.test(t) && !TOOL.test(t))) return true;
  if (WEAPON.test(t) && !TOY.test(t)) return true;
  return false;
}

/** A product (store + title) the catalog leaves out. */
export const restricted = (store, title) => restrictedShop(store) || restrictedTitle(title);
