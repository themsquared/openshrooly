/**
 * Substrate and spawn math for /tools/substrate-calculator. Shared by the build and the browser.
 * Each recipe is one published batch, scaled to the wet weight you want. Sources are on the page.
 */

/**
 * One published batch per substrate. `dry` amounts are grams as weighed, `water` is milliliters added,
 * `wet` is the batch's hydrated weight in grams. `density` is our rough packed wet density (kg per liter),
 * used only to turn a container size into a weight. Weigh your first batch to check it.
 */
export const SUBSTRATES = [
  {
    id: "cvg",
    name: "CVG (coco coir, vermiculite, gypsum)",
    short: "CVG",
    dry: [
      { id: "coir", name: "Coco coir (compressed brick)", g: 650 },
      { id: "vermiculite", name: "Vermiculite", g: 190, liters: 1.9 },
    ],
    gypsum: 170,
    water: 4250,
    density: 0.5,
    spawn: { low: 10, high: 20, default: 20 },
    prep: "Pour boiling water over the dry mix in a lidded bucket and leave it to cool, often overnight. This pasteurizes it.",
    note: "Gypsum is the usual 1 cup per 650 g brick. Coir bricks differ, so hold back some water and finish with the squeeze test.",
    species: ["pearl-oyster", "blue-oyster", "pink-oyster"],
    sources: ["cvg-rhizo", "cvg-ez"],
  },
  {
    id: "masters-mix",
    name: "Master's Mix (hardwood and soy hulls)",
    short: "Master's Mix",
    dry: [
      { id: "hardwood", name: "Hardwood fuel pellets or sawdust", g: 453 },
      { id: "soy", name: "Soybean hull pellets", g: 453 },
    ],
    gypsum: 0,
    water: 1400,
    density: 0.65,
    spawn: { low: 10, high: 20, default: 15 },
    prep: "Bag it and pressure sterilize at 15 PSI for 2.5 hours. It is too rich to pasteurize.",
    note: "The classic mix uses no gypsum. Some growers add about 1% of the dry weight.",
    species: ["lions-mane", "chestnut", "king-oyster", "pioppino", "pearl-oyster"],
    sources: ["freshcap"],
  },
  {
    id: "hardwood-sawdust",
    name: "Hardwood sawdust with wheat bran",
    short: "Supplemented sawdust",
    dry: [
      { id: "sawdust", name: "Hardwood sawdust or fuel pellets", g: 790 },
      { id: "bran", name: "Wheat bran", g: 200 },
    ],
    gypsum: 10,
    water: 1500,
    density: 0.6,
    spawn: { low: 5, high: 10, default: 10 },
    prep: "Bag it and sterilize at 121 °C (250 °F, 15 PSI) for 1 to 2 hours. Never pasteurize bran in an open tub.",
    note: "About 80% sawdust and 20% bran by dry weight with 1% gypsum or lime, at about 60% moisture.",
    species: ["shiitake", "lions-mane", "maitake", "reishi", "enoki", "nameko", "king-oyster"],
    sources: ["pennstate", "ucanr-sawdust"],
  },
  {
    id: "straw",
    name: "Straw (wheat or oat)",
    short: "Straw",
    dry: [{ id: "straw", name: "Chopped wheat or oat straw", g: 1000 }],
    gypsum: 0,
    water: 1860,
    density: 0.25,
    spawn: { low: 5, high: 10, default: 10 },
    prep: "Chop to 2.5 to 10 cm (1 to 4 in), hold in water at 71 to 74 °C (160 to 165 °F) for 1 to 2 hours, then drain. The water figure is what drained straw holds at about 65% moisture.",
    note: "No gypsum or bran for pasteurized straw. Extra nitrogen raises the mold risk.",
    species: ["pearl-oyster", "blue-oyster", "golden-oyster", "pink-oyster", "wine-cap"],
    sources: ["ufifas", "ucanr-sawdust"],
  },
  {
    id: "coffee",
    name: "Used coffee grounds",
    short: "Coffee grounds",
    dry: [
      { id: "coffee", name: "Fresh used coffee grounds (under 24 hours old)", g: 1000, wet: true },
      { id: "straw", name: "Pasteurized straw or hydrated sawdust pellets", g: 200, wet: true },
    ],
    gypsum: 0,
    water: 0,
    density: 0.6,
    spawn: { low: 10, high: 10, default: 10 },
    prep: "Brewing already heats the grounds. Use them within a day and mix in spawn right away.",
    note: "Grounds come wet from the machine, so add no water. Both amounts here are weighed wet. GroCycle sets spawn at 10% of the coffee weight.",
    species: ["pearl-oyster", "blue-oyster", "pink-oyster"],
    sources: ["grocycle"],
  },
];

export const byIdSubstrate = (id) => SUBSTRATES.find((s) => s.id === id) || SUBSTRATES[0];

export const VOLUME_UNITS = { l: 1, qt: 0.946352946, gal: 3.785411784 };

/** Batch wet weight in grams: dry ingredients, gypsum, and water. */
export function batchWet(sub) {
  return sub.dry.reduce((n, d) => n + d.g, 0) + sub.gypsum + sub.water;
}

/** Wet substrate weight in grams for a container: volume times fill fraction times packed density. */
export function containerWetGrams(volume, unit = "l", fillPercent = 50, sub = SUBSTRATES[0]) {
  const liters = Number(volume) * (VOLUME_UNITS[unit] || 1);
  const fill = Number(fillPercent) / 100;
  if (!(liters > 0) || !(fill > 0) || fill > 1) return NaN;
  return liters * fill * sub.density * 1000;
}

/**
 * Scale one recipe to a target wet substrate weight and add spawn at `spawnPercent` of that weight.
 * Returns null for bad input.
 */
export function substratePlan(sub, wetGrams, spawnPercent) {
  const wet = Number(wetGrams);
  const rate = Number(spawnPercent);
  if (!(wet > 0) || !(rate >= 0) || rate > 100) return null;
  const k = wet / batchWet(sub);
  const dry = sub.dry.map((d) => ({ ...d, g: d.g * k, liters: d.liters ? d.liters * k : undefined }));
  const spawn = (wet * rate) / 100;
  return {
    substrate: sub,
    scale: k,
    wet,
    dry,
    dryTotal: dry.filter((d) => !d.wet).reduce((n, d) => n + d.g, 0),
    gypsum: sub.gypsum * k,
    water: sub.water * k,
    spawn,
    spawnPercent: rate,
    total: wet + spawn,
  };
}

export function gramsText(g) {
  if (!(g > 0)) return "0 g";
  if (g >= 1000) return `${(g / 1000).toFixed(2)} kg (${(g / 453.59237).toFixed(1)} lb)`;
  return `${Math.round(g)} g (${(g / 28.349523).toFixed(1)} oz)`;
}

export function waterText(ml) {
  if (!(ml > 0)) return "None";
  if (ml >= 1000) return `${(ml / 1000).toFixed(2)} L (${(ml / 946.352946).toFixed(1)} qt)`;
  return `${Math.round(ml)} mL (${(ml / 236.588).toFixed(1)} cups)`;
}
