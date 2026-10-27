/**
 * Other common names people search for, per free culinary profile. The Latin name comes from the profile.
 * Only widely used names: each one appears in field guides or on major grower and grocer listings.
 * The first name is the one that goes in the page title, so keep it short.
 */
export const OTHER_NAMES = {
  "beech-shimeji": ["brown beech mushroom", "buna shimeji"],
  "blue-oyster": ["Pleurotus columbinus"],
  "button-cremini": ["white button", "cremini", "portobello"],
  chestnut: ["fat Pholiota"],
  "cordyceps-militaris": ["scarlet caterpillar club"],
  "elm-oyster": ["elm leech"],
  enoki: ["enokitake", "golden needle mushroom", "velvet shank"],
  "golden-oyster": ["yellow oyster", "tamogitake"],
  "king-oyster": ["king trumpet", "French horn mushroom", "eryngii"],
  "lions-mane": ["bearded tooth", "pom pom mushroom", "yamabushitake"],
  maitake: ["hen of the woods", "sheep's head"],
  nameko: ["butterscotch mushroom"],
  "pearl-oyster": ["oyster mushroom", "hiratake"],
  "pink-oyster": ["flamingo oyster", "salmon oyster"],
  pioppino: ["black poplar mushroom", "Agrocybe aegerita"],
  reishi: ["lingzhi", "varnished conk"],
  shiitake: ["black forest mushroom", "xiang gu"],
  "turkey-tail": ["Coriolus versicolor", "yun zhi"],
  "wine-cap": ["garden giant", "king stropharia"],
  "wood-ear": ["jelly ear", "black fungus", "kikurage"],
};

export function otherNames(id) {
  return OTHER_NAMES[id] || [];
}

/** "a", "a or b", "a, b, or c" */
export function orList(items) {
  if (items.length < 2) return items.join("");
  if (items.length === 2) return `${items[0]} or ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, or ${items[items.length - 1]}`;
}

export function latinName(profile) {
  const latin = profile.species || "";
  return latin.toLowerCase() === String(profile.name).toLowerCase() ? "" : latin;
}

/** Title tag for a species grow guide: common name, Latin name, and the most searched other name. */
export function speciesTitle(profile) {
  const make = (parts) => {
    const inner = parts.filter(Boolean).join(", ");
    return `How to grow ${profile.name}${inner ? ` (${inner})` : ""} at home`;
  };
  // Keep titles short enough to show whole in search results: drop the other name first.
  const full = make([latinName(profile), otherNames(profile.id)[0]]);
  return full.length <= TITLE_MAX ? full : make([latinName(profile)]);
}

/** Longest species page title, in characters. */
export const TITLE_MAX = 76;
