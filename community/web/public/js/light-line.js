/**
 * The light recipe in one plain line, for example
 * "Dark while it colonizes, then 12 h a day of cool white with some blue."
 */
export function lightRecipeLine(recipe) {
  const phases = recipe?.phases || {};
  const lit = phases.fruiting?.photoperiod_hours > 0 ? phases.fruiting : Object.values(phases).find((p) => p?.photoperiod_hours > 0);
  if (!lit) return "No light needed. It grows in the dark.";
  const white = Number(lit.white_brightness_percent) > 0;
  const color = Number(lit.blue_percent) > 0 ? "blue" : Number(lit.red_percent) > 0 ? "red" : Number(lit.green_percent) > 0 ? "green" : "";
  const mix = white && color ? `cool white with some ${color}` : white ? "cool white" : color ? `${color} light` : "light";
  const darkStart = phases.colonization && !(phases.colonization.photoperiod_hours > 0);
  return `${darkStart ? "Dark while it colonizes, then " : ""}${lit.photoperiod_hours} h a day of ${mix}.`.replace(/^./, (c) => c.toUpperCase());
}
