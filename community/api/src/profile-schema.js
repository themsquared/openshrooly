/** Shared mushroom profile schema. Same rules as shared/openshrooly_lib/schema.py. */

export const PROFILE_SCHEMA_VERSION = 1;

export class ValidationError extends Error {
  constructor(message, status = 400, code) {
    super(message);
    this.name = "ValidationError";
    this.status = status;
    if (code) this.code = code;
  }
}

export const STAGE_CATALOG = [
  { id: "colonization", name: "Colonization" },
  { id: "pinning", name: "Pinning" },
  { id: "fruiting", name: "Fruiting" },
  { id: "rest", name: "Rest" },
  { id: "flush", name: "Flush" },
  { id: "cold_shock", name: "Cold shock" },
  { id: "browning", name: "Browning" },
];

export const STAGE_IDS = new Set(STAGE_CATALOG.map((s) => s.id));
export const STAGE_ID_RE = /^[a-z][a-z0-9_]{0,31}$/;

export function isStageId(id) {
  return typeof id === "string" && STAGE_ID_RE.test(id) && STAGE_IDS.has(id);
}

export function isHttpsSourceUrl(url) {
  if (url == null || String(url).trim() === "") return true;
  try {
    const parsed = new URL(String(url).trim());
    return parsed.protocol === "https:" && Boolean(parsed.host);
  } catch {
    return false;
  }
}

export function httpsSourceHref(url) {
  if (!isHttpsSourceUrl(url) || url == null || String(url).trim() === "") return "";
  return new URL(String(url).trim()).href;
}

export const AFFILIATE_ID_RE = /^[a-z0-9-]{1,40}$/;
export const LIGHT_PHASE_IDS = new Set(["colonization", "pinning", "fruiting"]);

export function isAffiliateId(id) {
  return typeof id === "string" && AFFILIATE_ID_RE.test(id);
}

export function isHttpsAffiliateUrl(url) {
  if (url == null || String(url).trim() === "") return false;
  return isHttpsSourceUrl(url);
}

export function stripCommunityAffiliates(profile) {
  const next = structuredClone(profile);
  next.affiliate_links = [];
  return next;
}

const PSYCHOACTIVE_GENERA = new Set([
  "psilocybe",
  "panaeolus",
  "panaeolina",
  "copelandia",
  "gymnopilus",
  "pholiotina",
  "conocybe",
  "pluteus",
  "inocybe",
  "amanita",
]);
const CULINARY_GENERA = new Set([
  "gyroporus",
  "lentinus",
  "pleurotus",
  "agaricus",
  "lentinula",
  "hypsizygus",
  "flammulina",
  "grifola",
  "hericium",
  "ganoderma",
  "trametes",
  "stropharia",
  "cyclocybe",
  "pholiota",
  "cordyceps",
  "auricularia",
  "morchella",
  "tremella",
  "volvariella",
  "coprinus",
  "laetiporus",
  "sparassis",
  "inonotus",
  "agrocybe",
  "kuehneromyces",
  "fomitopsis",
]);
const SYSTEM_TAGS = new Set(["culinary", "psilocybin"]);
const CONFUSABLE_TO_LATIN = {
  а: "a",
  е: "e",
  о: "o",
  р: "p",
  с: "c",
  у: "y",
  х: "x",
  і: "i",
  ѕ: "s",
  ј: "j",
};
const OFFMENU_EPITHETS = new Set([
  "cubensis",
  "cyanescens",
  "semilanceata",
  "azurescens",
  "natalensis",
  "cyanopus",
  "salicinus",
  "aeruginascens",
  "tropicalis",
  "cambodginiensis",
  "cinctulus",
  "subbalteatus",
  "junonius",
  "spectabilis",
  "tampanensis",
  "mexicana",
  "baeocystis",
  "ovoideocystidiata",
  "allenii",
  "zapotecorum",
  "caerulescens",
]);
const OFFMENU_BINOMIALS = [
  "stropharia cubensis",
  "pluteus salicinus",
  "inocybe aeruginascens",
  "conocybe cyanopus",
  "pholiotina cyanopus",
];
const PLACEHOLDER_EPITHETS = new Set(["sp", "spp", "species", "unknown", "cf", "aff"]);
const VETTED_CULINARY_PAIRS = new Set(["gyroporus cyanescens"]);
const CUBE_STRAINS = [
  "albino a",
  "great white monster",
  "philosopher stone",
  "philosophers stone",
  "golden teacher",
  "penis envy",
  "albino penis envy",
  "blue meanie",
  "liberty cap",
  "wavy cap",
  "flying saucer",
  "treasure coast",
  "jack frost",
  "tidal wave",
  "avery s albino",
  "averys albino",
  "lizard king",
  "pink buffalo",
  "koh samui",
  "texas yellow",
  "z strain",
  "b plus",
  "mazatapec",
  "enigma",
  "thrasher",
  "mckennaii",
  "hillbilly",
  "huautla",
  "melmac",
];
const PSYCHOACTIVE_PHRASES = [
  "psilocybin",
  "psilocin",
  "magic mushroom",
  "magic mushrooms",
  "magic shroom",
  "magic shrooms",
  "magic truffle",
  "magic truffles",
];
const PROSE_PHRASES = [...PSYCHOACTIVE_PHRASES, ...CUBE_STRAINS];
const PROSE_WORDS = new Set(["shroom", "shrooms", "mushies", "cubes", "ape", "pe", "pe6", "gt", "jmf", "b+"]);
const LOOKALIKE_GENERA = new Set(["inocybe", "galerina"]);

export function stripAccents(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "");
}

export function foldConfusables(value) {
  return String(value || "").replace(/[аеорсухіѕјАЕОРСУХІЅЈ]/g, (ch) => CONFUSABLE_TO_LATIN[ch.toLowerCase()] || ch);
}

export function isLatinLetterSafe(value) {
  if (value == null || String(value).trim() === "") return true;
  const letters = stripAccents(value).match(/\p{L}/gu) || [];
  return letters.every((ch) => /[A-Za-z]/.test(ch));
}

export function normalizeTaxonText(value) {
  return foldConfusables(stripAccents(value))
    .normalize("NFKC")
    .replace(/\p{Cf}/gu, "")
    .toLowerCase()
    .replace(/[\u00a0\u2000-\u200b\u202f\u205f\u3000]/g, " ")
    .replace(/[^a-z0-9+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function foldTaxonToken(value) {
  return normalizeTaxonText(value).replace(/ /g, "").replace(/z/g, "s").replace(/y/g, "i");
}

export function foldEpithetToken(value) {
  return foldTaxonToken(value).replace(/(us|a)$/, "");
}

export function editDistance(a, b) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 2) return 99;
  const prev = new Array(n + 1);
  const cur = new Array(n + 1);
  for (let j = 0; j <= n; j += 1) prev[j] = j;
  for (let i = 1; i <= m; i += 1) {
    cur[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j += 1) prev[j] = cur[j];
  }
  return prev[n];
}

function nearMissToken(word, candidates, { fold = foldTaxonToken, maxDist = 1, minLen = 5 } = {}) {
  const folded = fold(word);
  if (!folded || folded.length < minLen) return false;
  for (const cand of candidates) {
    const cf = fold(cand);
    if (folded === cf) return true;
    if (Math.abs(folded.length - cf.length) > maxDist) continue;
    if (editDistance(folded, cf) <= maxDist) return true;
  }
  return false;
}

export function isPsychoactiveGenus(word) {
  const n = normalizeTaxonText(word).replace(/ /g, "");
  if (PSYCHOACTIVE_GENERA.has(n)) return true;
  return nearMissToken(word, PSYCHOACTIVE_GENERA, { fold: foldTaxonToken, maxDist: 1, minLen: 5 });
}

export function restrictedEpithetKind(word) {
  const compact = normalizeTaxonText(word).replace(/ /g, "");
  if (!compact) return null;
  if (OFFMENU_EPITHETS.has(compact)) return "exact";
  const folded = foldEpithetToken(compact);
  if (folded.length >= 6) {
    for (const epithet of OFFMENU_EPITHETS) {
      if (foldEpithetToken(epithet) === folded) return "fold";
    }
  }
  if (nearMissToken(compact, OFFMENU_EPITHETS, { fold: foldEpithetToken, maxDist: 2, minLen: 6 })) return "near";
  return null;
}

export function taxonKey(profile) {
  return ["id", "name", "species", "strain", "variety_group"].map((key) => normalizeTaxonText(profile?.[key])).join("|");
}

export function reviewConfirmExtra(review, profile) {
  if (!review?.confirmed_culinary_at) return {};
  if (!profile) return { confirmedCulinary: true };
  let live = null;
  if (review.live_document) {
    try {
      live = typeof review.live_document === "string" ? JSON.parse(review.live_document) : review.live_document;
    } catch {
      live = null;
    }
  }
  if (live && taxonKey(live) !== taxonKey(profile)) return {};
  return { confirmedCulinary: true };
}

export function collectTaxonFields(profile, extra = {}) {
  const fields = [
    extra.title,
    extra.description,
    profile?.name,
    profile?.species,
    profile?.strain,
    profile?.variety_group,
    profile?.summary,
    profile?.notes,
    profile?.chamber_notes,
    ...(Array.isArray(profile?.tags) ? profile.tags.filter((tag) => !SYSTEM_TAGS.has(normalizeTaxonText(tag))) : []),
  ];
  for (const stage of Array.isArray(profile?.stages) ? profile.stages : []) {
    if (stage && typeof stage === "object") fields.push(stage.name, stage.notes);
  }
  const recipe = profile?.light_recipe;
  if (recipe && typeof recipe === "object") {
    fields.push(recipe.why, recipe.notes);
    for (const note of Array.isArray(recipe.sources) ? recipe.sources : []) {
      fields.push(note?.title, note?.detail, note?.notes);
    }
    for (const phase of Object.values(recipe.phases || {})) {
      if (phase && typeof phase === "object") fields.push(phase.notes);
    }
  }
  for (const note of Array.isArray(profile?.source_notes) ? profile.source_notes : []) {
    fields.push(note?.title, note?.detail);
  }
  for (const link of Array.isArray(profile?.affiliate_links) ? profile.affiliate_links : []) {
    fields.push(link?.label, link?.merchant);
  }
  return fields.filter((value) => value != null && String(value).trim() !== "").map((value) => String(value));
}

function parseSpeciesParts(species) {
  const words = normalizeTaxonText(species).split(" ").filter(Boolean);
  const genus = words[0] || "";
  let epithet = words[1] || "";
  if (["var", "subsp", "ssp", "f", "forma"].includes(epithet)) epithet = words[2] || "";
  return { genus, epithet, words };
}

function identityFields(profile, extra = {}) {
  return [
    profile?.id,
    profile?.name,
    profile?.species,
    profile?.genus,
    extra.genus,
    extra.title,
    profile?.strain,
    profile?.variety_group,
  ].filter((value) => value != null && String(value).trim() !== "");
}

function proseFields(profile, extra = {}) {
  const identity = new Set(identityFields(profile, extra).map((value) => String(value)));
  return collectTaxonFields(profile, extra).filter((value) => !identity.has(value) && !SYSTEM_TAGS.has(normalizeTaxonText(value)));
}

function fieldRestrictedKind(raw) {
  const parsed = parseSpeciesParts(raw);
  const kinds = [];
  for (const word of parsed.words) {
    const kind = restrictedEpithetKind(word);
    if (kind) kinds.push(kind);
  }
  const epithetCompact = parsed.words.slice(1).join("");
  const compactKind = epithetCompact ? restrictedEpithetKind(epithetCompact) : null;
  if (compactKind) kinds.push(compactKind);
  if (kinds.includes("exact")) return "exact";
  if (kinds.includes("fold")) return "fold";
  if (kinds.includes("near")) return "near";
  return null;
}

function identityHasUnvettedRestricted(profile, extra = {}) {
  for (const raw of identityFields(profile, extra)) {
    const kind = fieldRestrictedKind(raw);
    if (!kind) continue;
    if (isVettedCulinaryPair(parseSpeciesParts(raw))) continue;
    return true;
  }
  return false;
}

function identityHasPsychoactiveGenus(profile, extra = {}) {
  for (const raw of identityFields(profile, extra)) {
    const parsed = parseSpeciesParts(raw);
    if (parsed.genus && isPsychoactiveGenus(parsed.genus)) return true;
    if (parsed.words.some((word) => isPsychoactiveGenus(word))) return true;
  }
  return false;
}

function identityHasLookalike(profile, extra = {}) {
  for (const raw of identityFields(profile, extra)) {
    const parsed = parseSpeciesParts(raw);
    if (
      parsed.words.some(
        (word) =>
          LOOKALIKE_GENERA.has(word) || nearMissToken(word, LOOKALIKE_GENERA, { fold: foldTaxonToken, maxDist: 1, minLen: 6 })
      )
    ) {
      return true;
    }
  }
  return false;
}

const IDENTITY_PROSE_WORDS = new Set(["cubes", "shroom", "shrooms", "mushies"]);
const CUBE_STRAIN_ALIASES = new Set(["b+", "bplus"]);

function textHasPhraseNearMiss(text, phrases, { maxDist = 1, minLen = 6 } = {}) {
  if (!text) return false;
  if (phrases.some((name) => text === name || text.includes(name))) return true;
  const words = text.split(" ");
  for (const name of phrases) {
    const n = name.split(" ").length;
    if (!n || words.length < n) continue;
    for (let i = 0; i <= words.length - n; i += 1) {
      const window = words.slice(i, i + n).join(" ");
      if (window === name) return true;
      if (nearMissToken(window, [name], { fold: foldTaxonToken, maxDist, minLen })) return true;
    }
  }
  return false;
}

function textHasCubeStrain(text) {
  if (!text) return false;
  if (textHasPhraseNearMiss(text, CUBE_STRAINS)) return true;
  return text.split(" ").some((word) => CUBE_STRAIN_ALIASES.has(word));
}

function identityHasPsychoactiveTerm(profile, extra = {}) {
  if (identityHasPsychoactiveGenus(profile, extra)) return true;
  if (identityHasLookalike(profile, extra)) return true;
  for (const raw of identityFields(profile, extra)) {
    if (isVettedCulinaryPair(parseSpeciesParts(raw))) continue;
    let text = normalizeTaxonText(raw);
    if (!text) continue;
    text = text.replace(/\bvitamin b\+/g, " ").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const wordSet = new Set(text.split(" "));
    if (textHasPhraseNearMiss(text, PSYCHOACTIVE_PHRASES)) return true;
    if (textHasCubeStrain(text)) return true;
    if ([...IDENTITY_PROSE_WORDS].some((word) => wordSet.has(word))) return true;
  }
  return false;
}

export function taxonLatinOk(profile, extra = {}) {
  return [profile?.species, profile?.strain, profile?.variety_group].every((value) => isLatinLetterSafe(value));
}

export function confirmLatinOk(profile, extra = {}) {
  return [profile?.species, profile?.strain, profile?.name, profile?.variety_group, profile?.id, extra.title].every((value) =>
    isLatinLetterSafe(value)
  );
}

function looksLikeCubeStrain(value) {
  const text = normalizeTaxonText(value);
  if (!text) return false;
  if (CUBE_STRAINS.some((name) => text === name || text.includes(name))) return true;
  const words = new Set(text.split(" "));
  return ["gt", "pe6", "jmf", "pe"].some((word) => words.has(word));
}

function hasForceMatch(values) {
  for (const raw of values) {
    const text = normalizeTaxonText(raw);
    if (!text) continue;
    const words = text.split(" ");
    const compact = text.replace(/ /g, "");
    const parsed = parseSpeciesParts(raw);
    if (PSYCHOACTIVE_GENERA.has(parsed.genus) && parsed.epithet && !PLACEHOLDER_EPITHETS.has(parsed.epithet)) {
      return true;
    }
    if (parsed.genus === "p" && OFFMENU_EPITHETS.has(parsed.epithet)) return true;
    if (OFFMENU_BINOMIALS.some((name) => text.includes(name) || compact.includes(name.replace(/ /g, "")))) return true;
    for (const genus of PSYCHOACTIVE_GENERA) {
      for (const epithet of OFFMENU_EPITHETS) {
        if (compact.includes(genus + epithet)) return true;
      }
    }
    if (words.some((word) => PSYCHOACTIVE_GENERA.has(word)) && words.some((word) => OFFMENU_EPITHETS.has(word))) {
      return true;
    }
    if (words.includes("p") && words.some((word) => OFFMENU_EPITHETS.has(word))) return true;
  }
  return false;
}

function hasProseFlag(values) {
  for (const raw of values) {
    let text = normalizeTaxonText(raw);
    if (!text) continue;
    text = text.replace(/\bvitamin b\+/g, " ").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const wordSet = new Set(text.split(" "));
    if (PROSE_PHRASES.some((name) => text.includes(name))) return true;
    if ([...PROSE_WORDS].some((word) => wordSet.has(word))) return true;
    if ([...LOOKALIKE_GENERA].some((genus) => wordSet.has(genus))) return true;
    if ([...PSYCHOACTIVE_GENERA].some((genus) => wordSet.has(genus) || text.includes(genus))) return true;
    if ([...OFFMENU_EPITHETS].some((epithet) => wordSet.has(epithet))) return true;
    if (OFFMENU_BINOMIALS.some((name) => text.includes(name))) return true;
    if (looksLikeCubeStrain(raw)) return true;
  }
  return false;
}

function offmenuEpithetsIn(parsed) {
  return parsed.words.filter((word) => OFFMENU_EPITHETS.has(word));
}

function isVettedCulinaryPair(parsed) {
  const epithets = new Set(offmenuEpithetsIn(parsed));
  const compact = parsed.words.slice(1).join("");
  if (compact && OFFMENU_EPITHETS.has(compact)) epithets.add(compact);
  if (!epithets.size) return false;
  return [...epithets].every((epithet) => VETTED_CULINARY_PAIRS.has(`${parsed.genus} ${epithet}`));
}

export function classifyTaxon(profile, extra = {}) {
  const identity = identityFields(profile, extra);
  const parsed = parseSpeciesParts(profile?.species);
  const hasSpecies = Boolean(String(profile?.species || "").trim());
  const culinaryGenus = CULINARY_GENERA.has(parsed.genus);
  const speciesRestricted = fieldRestrictedKind(profile?.species);
  const unvettedRestricted = identityHasUnvettedRestricted(profile, extra);
  const identityPsycho = identityHasPsychoactiveTerm(profile, extra);
  const vettedPair = Boolean(speciesRestricted) && culinaryGenus && isVettedCulinaryPair(parsed) && !unvettedRestricted;
  const identityForce = hasForceMatch(identity);
  const unknownGenus = Boolean(parsed.genus) && !culinaryGenus && !OFFMENU_EPITHETS.has(parsed.genus);
  const force = identityForce || (Boolean(speciesRestricted) && speciesRestricted !== "near" && unknownGenus && hasSpecies);
  const latinOk = taxonLatinOk(profile, extra);
  const realEpithet = Boolean(parsed.epithet) && !PLACEHOLDER_EPITHETS.has(parsed.epithet);
  const nearGenus = Boolean(parsed.genus) && isPsychoactiveGenus(parsed.genus);
  const culinary =
    !force &&
    culinaryGenus &&
    realEpithet &&
    latinOk &&
    !unvettedRestricted &&
    !nearGenus &&
    !identityPsycho &&
    (!speciesRestricted || vettedPair);
  const hold = !force && !culinary && (hasSpecies || identityPsycho);
  const identityStrainFlag = looksLikeCubeStrain(profile?.strain) || looksLikeCubeStrain(profile?.name);
  const proseFlag = hasProseFlag(proseFields(profile, extra)) || identityPsycho || identityStrainFlag;
  const reasons = [];
  if (identityForce || (force && !culinaryGenus)) reasons.push("High-confidence restricted taxon.");
  if (hold && (unvettedRestricted || (culinaryGenus && speciesRestricted))) {
    reasons.push("Culinary genus with a restricted epithet. Confirm only if this is a known edible pair.");
  }
  if (hold && !latinOk) reasons.push("Species or strain is not plain Latin letters.");
  if (hold && hasSpecies && !culinaryGenus && !unvettedRestricted && !identityPsycho) {
    reasons.push("Genus is not on the culinary allowlist.");
  }
  if (hold && culinaryGenus && !realEpithet && !unvettedRestricted && !identityPsycho) {
    reasons.push("Species uses a placeholder epithet such as sp.");
  }
  if (identityPsycho && !force) reasons.push("Name, strain, title, or variety mentions a restricted taxon.");
  if (proseFlag && !identityPsycho) reasons.push("Summary, notes, or tags mention a restricted name.");
  return { force, hold, culinary, proseFlag, reasons };
}

export function canConfirmCulinary(profile, extra = {}) {
  const classified = classifyTaxon(profile, extra);
  if (classified.force) return false;
  if (!confirmLatinOk(profile, extra)) return false;
  const parsed = parseSpeciesParts(profile?.species);
  if (!CULINARY_GENERA.has(parsed.genus)) return false;
  if (isPsychoactiveGenus(parsed.genus)) return false;
  if (identityHasPsychoactiveTerm(profile, extra)) return false;
  if (identityHasUnvettedRestricted(profile, extra)) return false;
  return classified.hold || classified.culinary;
}

export function needsOffmenuFlag(profile, extra = {}) {
  const classified = classifyTaxon(profile, extra);
  return classified.force || classified.hold || classified.proseFlag;
}

export function detectsRestrictedTaxon(profile, extra = {}) {
  return needsOffmenuFlag(profile, extra);
}

export const RANGES = {
  humidity_percent: { min: 30, max: 100, unit: "%" },
  temperature_c: { min: 10, max: 35, unit: "C" },
  duration_days: { exclusiveMin: 0, unit: "days" },
  fan_speed_percent: { min: 15, max: 100, unit: "%" },
  fan_period_min: { min: 1, max: 240, unit: "min" },
  fan_run_duration_s: { min: 5, max: 900, unit: "s" },
  photoperiod_hours: { min: 0, max: 24, unit: "h" },
  white_brightness_percent: { min: 0, max: 100, unit: "%" },
  rgb_percent: { min: 0, max: 100, unit: "%" },
  white_led_lux: { min: 0, max: 4000, unit: "lux" },
  sunrise_hour: { min: 0, max: 23, unit: "h" },
};

export const WAVELENGTH_NOTE =
  "WS2812 blue is roughly 465 to 475 nm. The RGB mix is an approximation of cited wavelengths, not a measured spectrum.";

export const STRIP_APPROX_NOTE = "The strip color is an approximation.";

export const PSILOCYBIN_LEGAL_NOTICE =
  "Psilocybin mushrooms are illegal to grow, possess, or sell in most countries and under US federal law. This information is published for educational, research and harm-reduction purposes only. Check the laws where you live. Shroom Labs does not sell spores, cultures or psilocybin products.";

export const PUBLISH_STATES = {
  draft: { label: "Draft", hint: "Saved for your chambers. Only you can see it." },
  pending: { label: "In review", hint: "Waiting for a moderator. Not on the public library yet." },
  pending_live: { label: "Edit in review", hint: "Your edit is waiting for a moderator. The published copy stays live." },
  published: { label: "Published", hint: "Live in the community library." },
  rejected: { label: "Not approved", hint: "A moderator did not approve this. See the reason." },
  changes_requested: { label: "Not approved", hint: "A moderator asked for changes. See the reason." },
};

function require(condition, message) {
  if (!condition) throw new ValidationError(message);
}

export function isPsilocybin(profile, extra = {}) {
  const classified = classifyTaxon(profile, extra);
  if (classified.force) return true;
  if (extra.confirmedCulinary) return false;
  if (extra.moderatorPack === "culinary" && canConfirmCulinary(profile, extra)) return false;
  if (classified.culinary) return false;
  return classified.hold || profile?.pack === "psilocybin" || Boolean(profile?.restricted);
}

export function isFree(profile) {
  const pricing = profile.pricing || { kind: "free", amount_cents: 0 };
  return pricing.kind === "free" || !pricing.amount_cents;
}

export function isPaid(profile) {
  return profile?.pricing?.kind === "paid" && Number(profile?.pricing?.amount_cents || 0) > 0;
}

export function cToF(c) {
  return (Number(c) * 9) / 5 + 32;
}

export function fToC(f) {
  return ((Number(f) - 32) * 5) / 9;
}

export function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function stageName(id) {
  return STAGE_CATALOG.find((s) => s.id === id)?.name || String(id).replaceAll("_", " ");
}

export function defaultStage(id) {
  const fruitingLike = id === "fruiting" || id === "pinning" || id === "flush";
  return {
    id,
    name: stageName(id),
    duration_days: fruitingLike ? 10 : 14,
    humidity_percent: fruitingLike ? 90 : 90,
    temperature_c: fruitingLike ? 18 : 24,
    humidity_hysteresis: 2,
    temperature_hysteresis: 1,
    temperature_control_enabled: true,
    temperature_warning_min_c: fruitingLike ? 13 : 19,
    temperature_warning_max_c: fruitingLike ? 23 : 29,
    humidifier_speed_percent: 75,
    light: {
      sunrise_hour: 8,
      duration_hours: fruitingLike ? 12 : 0,
      white_led_lux: fruitingLike ? 150 : 0,
      red_percent: 0,
      green_percent: 0,
      blue_percent: fruitingLike ? 80 : 0,
    },
    fan: {
      period_min: fruitingLike ? 15 : 60,
      run_duration_s: fruitingLike ? 30 : 15,
      speed_percent: fruitingLike ? 40 : 20,
    },
    notes: "",
  };
}

export function defaultLightPhase(id) {
  const fruitingLike = id === "fruiting" || id === "pinning" || id === "flush";
  return {
    photoperiod_hours: fruitingLike ? 12 : 0,
    white_brightness_percent: fruitingLike ? 40 : 0,
    red_percent: 0,
    green_percent: 0,
    blue_percent: fruitingLike ? 80 : 0,
  };
}

export function blankProfile({ id = "", name = "", pack = "culinary" } = {}) {
  const profile = {
    schema_version: PROFILE_SCHEMA_VERSION,
    id,
    name,
    species: "",
    strain: "",
    variety_group: "",
    pack,
    tags: pack === "psilocybin" ? ["psilocybin"] : ["culinary"],
    restricted: pack === "psilocybin",
    summary: "",
    notes: "",
    chamber_notes: "",
    legal_notice: pack === "psilocybin" ? PSILOCYBIN_LEGAL_NOTICE : null,
    source_notes: [],
    stages: [defaultStage("colonization"), defaultStage("fruiting")],
    pricing: { kind: "free", amount_cents: 0, currency: "USD", creator_share_percent: 70 },
    allowed_payment_providers: [],
    affiliates_allowed: pack !== "psilocybin",
    affiliate_links: [],
    firmware_compat: { min_version: "1.0.0", uses_existing_entities_only: true },
    light_recipe: {
      why: "Hours and mix for this chamber.",
      wavelength_note: WAVELENGTH_NOTE,
      sources: [{ title: "Grower", detail: "Recorded from this grow." }],
      phases: {
        colonization: defaultLightPhase("colonization"),
        fruiting: defaultLightPhase("fruiting"),
      },
    },
  };
  return applyPackRules(profile);
}

export function applyPackRules(profile, extra = {}) {
  const next = structuredClone(profile);
  if (!Array.isArray(next.tags)) next.tags = [];
  if (!Array.isArray(next.stages)) next.stages = blankProfile().stages;
  const classified = classifyTaxon(next, extra);
  if (extra.moderatorPack === "culinary" && !canConfirmCulinary(next, extra)) {
    throw new ValidationError("This taxon cannot be confirmed as culinary.", 400);
  }
  const confirmedCulinary = extra.moderatorPack === "culinary" || Boolean(extra.confirmedCulinary);
  const offMenu =
    extra.moderatorPack === "psilocybin" ||
    classified.force ||
    (!confirmedCulinary && classified.hold) ||
    (!classified.culinary && !confirmedCulinary && (next.pack === "psilocybin" || Boolean(next.restricted)));
  if (offMenu) {
    if (!next.pricing_before_hold) {
      next.pricing_before_hold = next.pricing;
      next.providers_before_hold = next.allowed_payment_providers;
      next.affiliates_allowed_before_hold = next.affiliates_allowed;
      next.affiliate_links_before_hold = next.affiliate_links;
    }
    next.pack = "psilocybin";
    next.restricted = true;
    if (!next.tags.includes("psilocybin")) next.tags = [...next.tags, "psilocybin"];
    next.pricing = { kind: "free", amount_cents: 0, currency: "USD", creator_share_percent: 70 };
    next.allowed_payment_providers = [];
    next.affiliates_allowed = false;
    next.affiliate_links = [];
    next.legal_notice = PSILOCYBIN_LEGAL_NOTICE;
  } else if (confirmedCulinary || classified.culinary) {
    next.pack = "culinary";
    next.restricted = false;
    next.tags = next.tags.filter((tag) => tag !== "psilocybin");
    if (!next.tags.includes("culinary")) next.tags = [...next.tags, "culinary"];
    next.legal_notice = null;
    if (confirmedCulinary && next.pricing_before_hold) {
      next.pricing = next.pricing_before_hold;
      next.allowed_payment_providers = next.providers_before_hold || [];
      if (next.affiliates_allowed_before_hold != null) next.affiliates_allowed = next.affiliates_allowed_before_hold;
      if (Array.isArray(next.affiliate_links_before_hold)) next.affiliate_links = next.affiliate_links_before_hold;
      delete next.pricing_before_hold;
      delete next.providers_before_hold;
      delete next.affiliates_allowed_before_hold;
      delete next.affiliate_links_before_hold;
    }
  } else {
    next.legal_notice = null;
  }
  if (next.light_recipe?.phases) {
    for (const key of Object.keys(next.light_recipe.phases)) {
      if (!LIGHT_PHASE_IDS.has(key)) delete next.light_recipe.phases[key];
    }
  }
  return next;
}

/** Serve-time pack/notice. Force-match taxa are rewritten; every Off-menu copy carries the legal notice. */
export function serveProfileDocument(profile, extra = {}) {
  if (!profile || typeof profile !== "object") return profile;
  const classified = classifyTaxon(profile, extra);
  if (classified.force) return applyPackRules(profile, extra);
  if (isPsilocybin(profile, extra)) {
    const next = applyPackRules(profile, extra);
    next.legal_notice = PSILOCYBIN_LEGAL_NOTICE;
    return next;
  }
  return structuredClone(profile);
}

/** Public card for a paid profile the reader has not unlocked. No recipe numbers. */
export function redactLockedProfile(profile) {
  return {
    id: profile.id,
    name: profile.name,
    species: profile.species,
    strain: profile.strain,
    summary: profile.summary,
    pricing: profile.pricing,
    pack: profile.pack,
    restricted: profile.restricted,
    tags: profile.tags,
    stages: (Array.isArray(profile.stages) ? profile.stages : []).map((s) => ({ id: s.id, name: s.name, duration_days: s.duration_days })),
    locked: true,
  };
}

export function canCloneFull(profile, { unlocked = false } = {}) {
  if (!profile) return false;
  if (profile.locked) return false;
  if (isPaid(profile) && !unlocked) return false;
  return Array.isArray(profile.stages) && profile.stages.some((s) => s.temperature_c != null);
}

export function cloneProfile(source, { id, name, author } = {}) {
  if (!canCloneFull(source, { unlocked: !source.locked })) {
    const blank = blankProfile({ id: id || `${slugify(source?.name || "profile")}-copy`, name: name || `${source?.name || "Profile"} copy` });
    blank.species = source?.species || "";
    blank.strain = source?.strain || "";
    blank.summary = source?.summary || "";
    blank.pack = source?.pack || "culinary";
    blank.fork_of = source?.id || null;
    blank.author = author || null;
    return applyPackRules(blank);
  }
  const next = structuredClone(source);
  next.id = id || `${source.id}-copy`;
  next.name = name || `${source.name} copy`;
  next.fork_of = source.id;
  next.author = author || next.author;
  next.pricing = { kind: "free", amount_cents: 0, currency: "USD", creator_share_percent: 70 };
  next.allowed_payment_providers = [];
  delete next.locked;
  return applyPackRules(next);
}

function addIssue(issues, path, message) {
  issues.push({ path, message });
}

function inRange(value, min, max) {
  return Number.isFinite(Number(value)) && Number(value) >= min && Number(value) <= max;
}

export function collectProfileIssues(profile, extra = {}) {
  const issues = [];
  if (!profile || typeof profile !== "object") {
    addIssue(issues, "document", "This is not a usable profile.");
    return issues;
  }
  if (!profile.id) addIssue(issues, "id", "Give this profile an id, like pearl-oyster.");
  else if (!/^[a-z0-9][a-z0-9-]*$/.test(profile.id)) {
    addIssue(issues, "id", "Use lowercase letters, numbers, and hyphens.");
  }
  if (!profile.name) addIssue(issues, "name", "Give this profile a name.");
  if (!profile.species) addIssue(issues, "species", "Add the species name.");
  if (profile.schema_version !== PROFILE_SCHEMA_VERSION) {
    addIssue(issues, "schema_version", "This profile uses a schema we cannot read.");
  }
  if (!["culinary", "psilocybin"].includes(profile.pack)) {
    addIssue(issues, "pack", "Pack must be culinary or Off-menu.");
  }
  if (!Array.isArray(profile.stages) || profile.stages.length < 1) {
    addIssue(issues, "stages", "Add at least one phase.");
  }

  const seen = new Set();
  for (const stage of Array.isArray(profile.stages) ? profile.stages : []) {
    const label = stage.name || stage.id || "phase";
    if (!isStageId(stage.id)) {
      addIssue(issues, `stages.${isStageId(stage.id) ? stage.id : "unknown"}.id`, `${label} needs a known phase id.`);
    }
    if (seen.has(stage.id)) addIssue(issues, `stages.${stage.id}`, `Two phases use the id ${stage.id}.`);
    seen.add(stage.id);
    if (!(Number(stage.duration_days) > 0)) {
      addIssue(issues, `stages.${stage.id}.duration_days`, `${label} duration must be greater than 0 days.`);
    }
    if (!inRange(stage.humidity_percent, 30, 100)) {
      addIssue(issues, `stages.${stage.id}.humidity_percent`, `${label} humidity must be 30 to 100%.`);
    }
    if (!inRange(stage.temperature_c, 10, 35)) {
      addIssue(issues, `stages.${stage.id}.temperature_c`, `${label} temperature must be 10 to 35 C.`);
    }
    const fan = stage.fan || {};
    const period = fan.period_min ?? 15;
    const run = fan.run_duration_s ?? 30;
    const speed = fan.speed_percent ?? 30;
    if (!inRange(speed, 15, 100)) {
      addIssue(issues, `stages.${stage.id}.fan.speed_percent`, `${label} fresh air must be 15 to 100%.`);
    }
    if (!inRange(period, 1, 240)) {
      addIssue(issues, `stages.${stage.id}.fan.period_min`, `${label} fan period must be 1 to 240 minutes.`);
    }
    if (!inRange(run, 5, 900)) {
      addIssue(issues, `stages.${stage.id}.fan.run_duration_s`, `${label} fan run time must be 5 to 900 seconds.`);
    }
    if (period * 60 - run < 60) {
      addIssue(issues, `stages.${stage.id}.fan.run_duration_s`, `${label} fan cycle needs at least 60 seconds off.`);
    }
    const light = stage.light || {};
    if (light.sunrise_hour != null && !inRange(light.sunrise_hour, 0, 23)) {
      addIssue(issues, `stages.${stage.id}.light.sunrise_hour`, `${label} sunrise must be hour 0 to 23.`);
    }
    if (light.duration_hours != null && !inRange(light.duration_hours, 0, 24)) {
      addIssue(issues, `stages.${stage.id}.light.duration_hours`, `${label} light hours must be 0 to 24.`);
    }
    if (light.white_led_lux != null && !inRange(light.white_led_lux, 0, 4000)) {
      addIssue(issues, `stages.${stage.id}.light.white_led_lux`, `${label} white light must be 0 to 4000 lux.`);
    }
    for (const channel of ["red_percent", "green_percent", "blue_percent"]) {
      if (light[channel] != null && !inRange(light[channel], 0, 100)) {
        addIssue(issues, `stages.${stage.id}.light.${channel}`, `${label} ${channel.replace("_percent", "")} must be 0 to 100%.`);
      }
    }
  }

  if (profile.light_recipe) issues.push(...collectLightRecipeIssues(profile.light_recipe));

  const pricing = profile.pricing || { kind: "free", amount_cents: 0 };
  if (pricing.kind === "paid") {
    if (!(pricing.amount_cents >= 100 && pricing.amount_cents <= 2000)) {
      addIssue(issues, "pricing.amount_cents", "Paid profiles must be $1 to $20.");
    }
    if (!(profile.allowed_payment_providers || []).length) {
      addIssue(issues, "allowed_payment_providers", "Paid profiles need a payment provider.");
    }
  } else if (pricing.amount_cents) {
    addIssue(issues, "pricing.amount_cents", "Free profiles must have a price of $0.");
  }

  if (isPsilocybin(profile, extra)) {
    if (profile.pack !== "psilocybin") addIssue(issues, "pack", "Off-menu profiles must use the Off-menu pack.");
    if (!profile.restricted) addIssue(issues, "restricted", "Off-menu profiles must stay restricted.");
    if (!isFree(profile)) addIssue(issues, "pricing.kind", "Off-menu profiles must stay free.");
    if ((profile.allowed_payment_providers || []).length) {
      addIssue(issues, "allowed_payment_providers", "Off-menu profiles cannot take payments.");
    }
    if (profile.affiliates_allowed !== false) {
      addIssue(issues, "affiliates_allowed", "Off-menu profiles cannot allow affiliate links.");
    }
    if ((profile.affiliate_links || []).length) {
      addIssue(issues, "affiliate_links", "Off-menu profiles cannot carry affiliate links.");
    }
    if (profile.legal_notice !== PSILOCYBIN_LEGAL_NOTICE) addIssue(issues, "legal_notice", "Off-menu profiles need the legal note.");
  }
  if (profile.affiliates_allowed === false && (profile.affiliate_links || []).length) {
    addIssue(issues, "affiliate_links", "Turn off affiliate links or remove them.");
  }
  for (const [i, link] of (profile.affiliate_links || []).entries()) {
    if (!isAffiliateId(link?.id)) addIssue(issues, `affiliate_links.${i}.id`, "Affiliate ids must be short lowercase letters, numbers, or hyphens.");
    if (!isHttpsAffiliateUrl(link?.url)) addIssue(issues, `affiliate_links.${i}.url`, "Affiliate links must use https.");
  }
  return issues;
}

export function collectLightRecipeIssues(recipe) {
  const issues = [];
  if (!String(recipe.why || "").trim()) addIssue(issues, "light_recipe.why", "Say why this light mix is used.");
  if (!String(recipe.wavelength_note || "").trim()) {
    addIssue(issues, "light_recipe.wavelength_note", "Keep the note that the strip color is an approximation.");
  }
  if (!Array.isArray(recipe.sources) || recipe.sources.length < 1) {
    addIssue(issues, "light_recipe.sources", "Add at least one light recipe source.");
  }
  for (const [i, note] of (recipe.sources || []).entries()) {
    if (!String(note.title || "").trim()) addIssue(issues, `light_recipe.sources.${i}.title`, "Each source needs a title.");
    if (!String(note.detail || "").trim()) addIssue(issues, `light_recipe.sources.${i}.detail`, "Each source needs a short note.");
    if (!isHttpsSourceUrl(note.url)) {
      addIssue(issues, `light_recipe.sources.${i}.url`, "Source links must use https.");
    }
  }
  const phases = recipe.phases || {};
  if (!phases.colonization) addIssue(issues, "light_recipe.phases.colonization", "Add a colonization light mix.");
  if (!phases.fruiting) addIssue(issues, "light_recipe.phases.fruiting", "Add a fruiting light mix.");
  for (const [name, phase] of Object.entries(phases)) {
    if (!LIGHT_PHASE_IDS.has(name)) {
      addIssue(issues, `light_recipe.phases.${name}`, "Light recipe phases must be colonization, pinning, or fruiting.");
      continue;
    }
    if (!inRange(phase.photoperiod_hours, 0, 24)) {
      addIssue(issues, `light_recipe.phases.${name}.photoperiod_hours`, `${name} hours on must be 0 to 24.`);
    }
    if (!inRange(phase.white_brightness_percent, 0, 100)) {
      addIssue(issues, `light_recipe.phases.${name}.white_brightness_percent`, `${name} white brightness must be 0 to 100%.`);
    }
    for (const channel of ["red_percent", "green_percent", "blue_percent"]) {
      if (!inRange(phase[channel], 0, 100)) {
        addIssue(issues, `light_recipe.phases.${name}.${channel}`, `${name} ${channel.replace("_percent", "")} must be 0 to 100%.`);
      }
    }
  }
  return issues;
}

export function validateProfile(profile, extra = {}) {
  const normalized = applyPackRules(profile, extra);
  const issues = collectProfileIssues(normalized, extra);
  if (issues.length) throw new ValidationError(issues[0].message);
  return normalized;
}

export function validateLightRecipe(recipe) {
  const issues = collectLightRecipeIssues(recipe);
  if (issues.length) throw new ValidationError(issues[0].message);
  return recipe;
}

export function issuesFor(issues, path) {
  return issues.filter((i) => i.path === path || i.path.startsWith(`${path}.`));
}

export function firstIssue(issues, path) {
  return issues.find((i) => i.path === path || i.path.startsWith(`${path}.`))?.message || "";
}

/** Keep light_recipe and per-stage light in sync so firmware mapping stays honest. */
export function syncStageLightFromRecipe(profile) {
  const next = structuredClone(profile);
  const recipe = next.light_recipe;
  if (!recipe?.phases) return next;
  for (const stage of next.stages || []) {
    const phase = recipe.phases[stage.id] || (["pinning", "fruiting", "flush"].includes(stage.id) ? recipe.phases.fruiting : recipe.phases.colonization);
    if (!phase) continue;
    stage.light = stage.light || {};
    stage.light.duration_hours = phase.photoperiod_hours;
    stage.light.white_led_lux = Math.round((Number(phase.white_brightness_percent) / 100) * 400);
    stage.light.red_percent = phase.red_percent;
    stage.light.green_percent = phase.green_percent;
    stage.light.blue_percent = phase.blue_percent;
    if (stage.light.sunrise_hour == null) stage.light.sunrise_hour = 8;
  }
  return next;
}

export function parseProfileDocument(text) {
  let data;
  try {
    data = typeof text === "string" ? JSON.parse(text) : text;
  } catch {
    throw new ValidationError("That profile document is not valid.");
  }
  if (!data || typeof data !== "object") throw new ValidationError("That profile document is not valid.");
  return data;
}

export function exportProfileDocument(profile) {
  return `${JSON.stringify(profile, null, 2)}\n`;
}

export function publishReadyIssues({ title, description, photos }) {
  const issues = [];
  if (!String(title || "").trim()) addIssue(issues, "publish.title", "Add a title before you send this to the library.");
  if (!String(description || "").trim()) {
    addIssue(issues, "publish.description", "Add a short description before you send this to the library.");
  }
  if (!Array.isArray(photos) || photos.length < 1) {
    addIssue(issues, "publish.photos", "Add at least one photo before you send this to the library.");
  }
  if (Array.isArray(photos) && photos.length > 4) {
    addIssue(issues, "publish.photos", "Use at most four photos.");
  }
  return issues;
}
