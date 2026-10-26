/**
 * What a linked chamber's own page shows about its grow: the mushroom's name,
 * its page on the site, and a small photo. Rides on the inbox reply.
 * Strings are short printable ASCII so the chamber can store and echo them as is.
 * The photo tables mirror web/public/js/species-art.js and species-photos.js; test/chamber-grow.test.js keeps them in step.
 */
import { SQL as ALERT_SQL } from "./alerts/store.js";
import { readRules } from "./alerts/rules.js";
import { isOffMenu, profilePath } from "./pack.js";

// Off-menu profiles with a licensed photo, and the smallest copy the site has of each.
const LICENSED = {
  "golden-teacher": "/img/species/golden-teacher-640.webp",
  "b-plus": "/img/species/b-plus-640.webp",
  "p-cyanescens": "/img/species/p-cyanescens-640.webp",
  "penis-envy": "/img/species/penis-envy-640.webp",
  "p-natalensis": "/img/species/p-natalensis-528.webp",
  "acadian-coast": "/img/species/acadian-coast-640.webp",
  "treasure-coast": "/img/species/treasure-coast-640.webp",
};

const PHOTOS = [
  [["pink", "oyster"], "pink-oyster"],
  [["golden", "oyster"], "golden-oyster"],
  [["king", "oyster"], "king-oyster"],
  [["blue", "oyster"], "blue-oyster"],
  [["elm", "oyster"], "elm-oyster"],
  [["ulmarius"], "elm-oyster"],
  [["beech"], "beech"],
  [["shimeji"], "beech"],
  [["tessulatus"], "beech"],
  [["cremini"], "cremini"],
  [["button"], "cremini"],
  [["agaricus"], "cremini"],
  [["chestnut"], "chestnut"],
  [["pholiota adiposa"], "chestnut"],
  [["cordyceps"], "cordyceps"],
  [["maitake"], "maitake"],
  [["grifola"], "maitake"],
  [["turkey"], "turkey-tail"],
  [["trametes"], "turkey-tail"],
  [["wine"], "wine-cap"],
  [["stropharia"], "wine-cap"],
  [["nameko"], "nameko"],
  [["pholiota microspora"], "nameko"],
  [["pioppino"], "pioppino"],
  [["cyclocybe"], "pioppino"],
  [["wood ear"], "wood-ear"],
  [["auricularia"], "wood-ear"],
  [["lion", "mane"], "lions-mane"],
  [["hericium"], "lions-mane"],
  [["shiitake"], "shiitake"],
  [["lentinula"], "shiitake"],
  [["reishi"], "reishi"],
  [["ganoderma"], "reishi"],
  [["enoki"], "enoki"],
  [["flammulina"], "enoki"],
  [["oyster"], "oyster"],
  [["pleurotus"], "oyster"],
];

function offMenuArt(profile) {
  if (isOffMenu(profile)) return true;
  return /\bpsilocybe\b|\bpsilocybin\b/.test(`${profile.species || ""} ${profile.strain || ""} ${profile.name || ""}`.toLowerCase());
}

/** Site path of the small photo for a profile, or "" when it has none (Off-menu without a licensed photo). */
export function chamberPhotoPath(profile) {
  if (!profile) return "";
  if (LICENSED[profile.id]) return LICENSED[profile.id];
  if (offMenuArt(profile)) return "";
  const blob = `${profile.species || ""} ${profile.strain || ""} ${profile.name || ""}`.toLowerCase();
  const hit = PHOTOS.find(([keys]) => keys.every((key) => blob.includes(key)));
  return `/img/species/species-${hit ? hit[1] : "generic"}-640.webp`;
}

export function chamberText(value, max) {
  return String(value || "").replace(/[^\x20-\x7e]/g, "").replace(/["\\<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max).trim();
}

const NONE = { grow_name: "", grow_url: "", grow_image: "" };

/** Empty strings mean "nothing picked", so the chamber clears what it showed. */
export async function chamberGrow(db, env, device) {
  try {
    const [rulesRow, modeRow] = await Promise.all([
      db.one(ALERT_SQL.rulesGet, [device.id]),
      db.one("SELECT * FROM coach_device_mode WHERE device_id=?", [device.id]),
    ]);
    const id = readRules(rulesRow?.document).grow?.profile_id || modeRow?.profile_id;
    if (!id) return NONE;
    const row = await db.one("SELECT * FROM profiles WHERE id=?", [id]);
    if (!row) return NONE;
    const published = Boolean(Number(row.published));
    const owned = row.author_id != null && device.owner_id != null && Number(row.author_id) === Number(device.owner_id);
    if (!published && !owned) return NONE;
    const doc = typeof row.document === "string" ? JSON.parse(row.document) : row.document || {};
    const profile = { ...doc, id: doc.id || row.id };
    const name = chamberText(profile.name || profile.species || profile.id, 40);
    if (!name) return NONE;
    const site = String(env?.SITE_ORIGIN || "https://shroomlabs.io").replace(/\/$/, "");
    const path = published ? profilePath(profile.id) : "";
    const photo = chamberPhotoPath(profile);
    return {
      grow_name: name,
      grow_url: path && path.length < 100 ? `${site}${path}` : "",
      grow_image: photo ? `${site}${photo}` : "",
    };
  } catch {
    // A missing table or bad profile row must never break the inbox.
    return NONE;
  }
}
