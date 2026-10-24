/** Profile validation: same rules as shared/openshrooly_lib/schema.py */

export const PROFILE_SCHEMA_VERSION = 1;

export class ValidationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "ValidationError";
    this.status = status;
  }
}

function require(condition, message) {
  if (!condition) throw new ValidationError(message);
}

export function isPsilocybin(profile) {
  return (
    profile.pack === "psilocybin" ||
    Boolean(profile.restricted) ||
    (profile.tags || []).includes("psilocybin")
  );
}

export function isFree(profile) {
  const pricing = profile.pricing || { kind: "free", amount_cents: 0 };
  return pricing.kind === "free" || !pricing.amount_cents;
}

export function validateProfile(profile) {
  require(Boolean(profile.id), "profile.id is required");
  require(Boolean(profile.name), "profile.name is required");
  require(Boolean(profile.species), "profile.species is required");
  require(Array.isArray(profile.stages) && profile.stages.length >= 1, "profile must include at least one stage");
  require(
    profile.schema_version === PROFILE_SCHEMA_VERSION,
    `unsupported schema_version ${profile.schema_version}`
  );
  require(["culinary", "psilocybin"].includes(profile.pack), "pack must be culinary or psilocybin");

  const seen = new Set();
  for (const stage of profile.stages) {
    require(!seen.has(stage.id), `duplicate stage id ${stage.id}`);
    seen.add(stage.id);
    require(stage.duration_days > 0, `stage ${stage.id} duration_days must be > 0`);
    require(stage.humidity_percent >= 30 && stage.humidity_percent <= 100, `stage ${stage.id} humidity out of range`);
    require(stage.temperature_c >= 10 && stage.temperature_c <= 35, `stage ${stage.id} temperature out of range`);
    const fan = stage.fan || {};
    const period = fan.period_min ?? 15;
    const run = fan.run_duration_s ?? 30;
    const speed = fan.speed_percent ?? 30;
    require(speed >= 15 && speed <= 100, `stage ${stage.id} fan speed invalid`);
    require(period >= 1 && period <= 240, `stage ${stage.id} fan period invalid`);
    require(run >= 5 && run <= 900, `stage ${stage.id} fan run duration invalid`);
    require(period * 60 - run >= 60, `stage ${stage.id} fan cycle needs >= 60s downtime`);
    const light = stage.light || {};
    if (light.red_percent != null) require(light.red_percent >= 0 && light.red_percent <= 100, `stage ${stage.id} red percent invalid`);
    if (light.green_percent != null) require(light.green_percent >= 0 && light.green_percent <= 100, `stage ${stage.id} green percent invalid`);
    if (light.blue_percent != null) require(light.blue_percent >= 0 && light.blue_percent <= 100, `stage ${stage.id} blue percent invalid`);
  }

  if (profile.light_recipe) validateLightRecipe(profile.light_recipe);

  const pricing = profile.pricing || { kind: "free", amount_cents: 0 };
  if (pricing.kind === "paid") {
    require(pricing.amount_cents >= 100 && pricing.amount_cents <= 2000, "paid profiles must be $1-$20");
    require((profile.allowed_payment_providers || []).length > 0, "paid profiles need allowed_payment_providers");
  } else {
    require(!pricing.amount_cents, "free profiles must have amount_cents=0");
  }

  if (isPsilocybin(profile)) {
    require(profile.pack === "psilocybin", "psilocybin profiles must use pack=psilocybin");
    require(profile.restricted, "psilocybin profiles must set restricted=true");
    require(isFree(profile), "psilocybin pack must remain free in this release");
    require(!(profile.allowed_payment_providers || []).length, "psilocybin pack cannot route payments");
    require(profile.affiliates_allowed === false, "psilocybin pack cannot allow affiliates");
    require(!(profile.affiliate_links || []).length, "psilocybin pack cannot carry affiliate links");
    require(Boolean(profile.legal_notice), "psilocybin profiles need a legal_notice");
  }
  if (profile.affiliates_allowed === false) {
    require(!(profile.affiliate_links || []).length, "affiliates_allowed=false cannot include links");
  }
  return profile;
}

export function validateLightRecipe(recipe) {
  require(Boolean(String(recipe.why || "").trim()), "light_recipe.why is required");
  require(Boolean(String(recipe.wavelength_note || "").trim()), "light_recipe.wavelength_note is required");
  require(Array.isArray(recipe.sources) && recipe.sources.length >= 1, "light_recipe needs at least one source");
  for (const note of recipe.sources) {
    require(Boolean(String(note.title || "").trim()), "light_recipe source title is required");
    require(Boolean(String(note.detail || "").trim()), "light_recipe source detail is required");
  }
  const phases = recipe.phases || {};
  require(Boolean(phases.colonization), "light_recipe needs a colonization phase");
  require(Boolean(phases.fruiting), "light_recipe needs a fruiting phase");
  for (const [name, phase] of Object.entries(phases)) {
    require(phase.photoperiod_hours >= 0 && phase.photoperiod_hours <= 24, `light_recipe ${name} photoperiod invalid`);
    require(
      phase.white_brightness_percent >= 0 && phase.white_brightness_percent <= 100,
      `light_recipe ${name} white brightness invalid`
    );
    for (const channel of ["red_percent", "green_percent", "blue_percent"]) {
      require(phase[channel] >= 0 && phase[channel] <= 100, `light_recipe ${name} ${channel} invalid`);
    }
  }
  return recipe;
}

export function affiliateLinksFor(profile) {
  if (isPsilocybin(profile) || profile.affiliates_allowed === false) return [];
  return profile.affiliate_links || [];
}

export function assertAffiliateAllowed(profile, link) {
  if (profile && (isPsilocybin(profile) || profile.affiliates_allowed === false)) {
    throw new ValidationError(
      "Affiliate links cannot be attached to the psilocybin pack (payment processors and affiliate programs prohibit it).",
      403
    );
  }
  if (link && !/^https?:\/\//.test(link.url)) {
    throw new ValidationError("affiliate url must be http(s)");
  }
}
