/**
 * The free tools. Each page is server rendered with a worked example, so it reads fine without
 * JavaScript and crawlers see real numbers. js/tools.js takes over the form in the browser.
 */
import { airChanges, chamberLiters, flowLpm, REFERENCE_ACH, round, timeline } from "../../public/js/tool-math.js";
import { airResult, esc, substrateResult, table, timelineResult } from "../../public/js/tool-render.js";
import { SUBSTRATES, byIdSubstrate, substratePlan, batchWet, gramsText } from "../../public/js/substrate-math.js";
import { link, toolSpecies } from "../guides/data.js";

export const TOOLS_UPDATED = "2026-10-27";
export const SPECIES = toolSpecies();
const byId = (id) => SPECIES.find((s) => s.id === id);

const UCANR = "https://ucanr.edu/sites/default/files/2012-05/144772.pdf";
const SARE = "https://projects.sare.org/media/pdf/F/u/n/FungiAlly_Oyster_booklet_Final-1.pdf";
export const TOOL_SOURCES = [
  ["UC Agriculture and Natural Resources, Cultivating Mushrooms on Small Family Farms", UCANR],
  ["SARE and FungiAlly, Growing Oyster Mushrooms", SARE],
];


function speciesSelect(id, selected) {
  return `<select id="${id}" name="species">${SPECIES.map((s) => `<option value="${s.id}"${s.id === selected ? " selected" : ""}>${esc(s.name)}</option>`).join("")}</select>`;
}

/* ---------- grow timeline ---------- */

const exampleSpecies = byId("pearl-oyster");
const examplePlan = timeline(exampleSpecies);

const allTotals = SPECIES.map((s) => [s, timeline(s).total]).sort((a, b) => a[1] - b[1]);

const growTimeline = {
  slug: "grow-timeline",
  script: "/js/tools.js",
  title: "Mushroom grow timeline calculator: dates for every stage",
  h1: "Mushroom grow timeline calculator",
  description: "Pick a mushroom and a start date to get the date each stage begins, its temperature, humidity, and light, and your harvest window. Add it to your calendar.",
  answer: `Pick a mushroom and the day you start, and this calculator lists the date each stage begins, the temperature, humidity, fresh air, and light to use, and your first harvest window. Totals run from ${allTotals[0][1]} days for ${allTotals[0][0].name.toLowerCase()} to ${allTotals[allTotals.length - 1][1]} days for ${allTotals[allTotals.length - 1][0].name.toLowerCase()}. You can save every stage to your calendar as an .ics file.`,
  form: () => `<form class="tool-form card" id="tool-form" data-tool="grow-timeline" novalidate>
  <label for="tl-species">Mushroom</label>
  ${speciesSelect("tl-species", exampleSpecies.id)}
  <label for="tl-start">Start date</label>
  <input id="tl-start" name="start" type="date" required>
  <fieldset class="tool-choice">
    <legend>Starting from</legend>
    <label class="toggle"><input type="radio" name="from" value="spawn" checked> A fresh block or bag (colonization ahead)</label>
    <label class="toggle"><input type="radio" name="from" value="kit"> A fully colonized kit or block</label>
  </fieldset>
  <div class="tool-actions"><button type="submit" class="button">Show my dates</button><button type="button" class="button secondary" id="tl-ics" disabled>Add to calendar (.ics)</button></div>
</form>`,
  result: () => timelineResult(exampleSpecies, examplePlan),
  sections: [
    {
      h2: "How does the grow timeline calculator work?",
      html: `<p>Each free grow profile lists its stages and how many days each one lasts. The calculator adds those days to your start date. Day 1 is the day you start. For most species the stages are colonization, pinning, and fruiting. ${link("shiitake")} adds browning and a cold shock, which is why it takes longer than the rest.</p>
<p>The fruiting stage is your first harvest window. Pick each cluster when it is ready, which is often before the stage ends.</p>`,
    },
    {
      h2: "What if my kit is already colonized?",
      html: `<p>Choose "A fully colonized kit or block". The calculator skips colonization and starts at pinning. Most store bought kits arrive fully colonized, so pins usually show within a week or two of opening them in good conditions. A pre browned ${link("shiitake")} block also skips browning and starts at the cold shock.</p>`,
    },
    {
      h2: "How long does each mushroom take to grow?",
      html: `${table(
        "Days from the start of colonization to the end of the first harvest",
        ["Mushroom", "Total days"],
        allTotals.map(([s, total]) => `<tr><th scope="row">${link(s.id)}</th><td>${total}</td></tr>`)
      )}
<p>See <a href="/guides/how-long-to-grow-mushrooms">how long mushrooms take to grow</a> for each stage, and the time from a kit.</p>`,
    },
    {
      h2: "Can a chamber follow these stages for me?",
      html: `<p>Yes, if you grow in a Shrooly running OpenShrooly. Load the same free profile on the chamber and it steps through each stage on these days. <a href="/coach">Grow Coach</a> reads the chamber's live readings and suggests humidity and temperature changes for the stage you are in, so you are not guessing from a date alone.</p>`,
    },
    {
      h2: "Why might my dates be different?",
      html: `<p>Colonization speed depends on temperature, how much spawn went into the block, and the strain. A cool room can add a week or more. Pins need humidity, fresh air, and light at the same time, and they stall without them. If nothing has happened by the end of a stage, read <a href="/guides/mushroom-grow-kit-not-growing">grow kit not growing</a> or <a href="/guides/mushrooms-not-pinning">mushrooms not pinning</a>.</p>`,
    },
    {
      h2: "How do I add the dates to my calendar?",
      html: `<p>Press "Add to calendar". Your browser saves an .ics file with one all day event per stage. Open it with Google Calendar, Apple Calendar, or Outlook to import the events. Each event lists that stage's temperature, humidity, fresh air, and light.</p>`,
    },
  ],
  faq: [
    { q: "How long does it take to grow mushrooms at home?", a: `From the start of colonization to the end of the first harvest, the free profiles run from ${allTotals[0][1]} days for ${allTotals[0][0].name.toLowerCase()} to ${allTotals[allTotals.length - 1][1]} days for ${allTotals[allTotals.length - 1][0].name.toLowerCase()}. Most oysters finish in under five weeks.` },
    { q: "Does the calculator work for a grow kit?", a: "Yes. Choose a fully colonized kit or block and the timeline starts at pinning instead of colonization." },
    { q: "Can I save the timeline to my calendar?", a: "Yes. The Add to calendar button downloads an .ics file with one all day event per stage, which Google Calendar, Apple Calendar, and Outlook can import." },
    { q: "Where do the numbers come from?", a: "From the free Shroom Labs grow profiles, the same stage lengths, temperatures, humidity, fan cycles, and light hours shown on each species page." },
  ],
  related: [
    ["How long does it take to grow mushrooms?", "/guides/how-long-to-grow-mushrooms"],
    ["Fresh air and humidity planner", "/tools/fresh-air-planner"],
    ["Mushroom grow kit not growing", "/guides/mushroom-grow-kit-not-growing"],
    ["Grow Coach", "/coach"],
    ["All free grow tools", "/tools"],
  ],
};

/* ---------- fresh air planner ---------- */

const EX = { l: 40, w: 30, h: 30, unit: "cm", flow: 5, flowUnit: "cfm" };
const exFruit = exampleSpecies.stages.find((s) => s.id === "fruiting");
const exLiters = chamberLiters(EX.l, EX.w, EX.h, EX.unit);
const exAir = airChanges({ liters: exLiters, lpm: flowLpm(EX.flow, EX.flowUnit), runS: exFruit.fan.run, everyMin: exFruit.fan.every });

const freshAir = {
  slug: "fresh-air-planner",
  script: "/js/tools.js",
  title: "Mushroom fresh air calculator: air changes per hour for your chamber",
  h1: "Mushroom fresh air and humidity planner",
  description: "Enter your grow chamber size and fan flow to get air changes per hour, next to the humidity and fan cycle your mushroom needs. Works in cm or inches.",
  answer: `Enter your chamber size and fan flow, and this planner works out how many times an hour your fan replaces the air in the chamber, next to the humidity and fan cycle your mushroom's profile uses. Oyster growing rooms are commonly run at about ${REFERENCE_ACH.low} to ${REFERENCE_ACH.high} fresh air changes an hour while fruiting, so you get a number to compare against.`,
  form: () => `<form class="tool-form card" id="tool-form" data-tool="fresh-air-planner" novalidate>
  <div class="tool-grid">
    <div><label for="fa-species">Mushroom</label>${speciesSelect("fa-species", exampleSpecies.id)}</div>
    <div><label for="fa-stage">Stage</label><select id="fa-stage" name="stage">${exampleSpecies.stages
      .map((s) => `<option value="${s.id}"${s.id === "fruiting" ? " selected" : ""}>${esc(s.name)}</option>`)
      .join("")}</select></div>
  </div>
  <fieldset class="tool-dims"><legend>Chamber inside size</legend>
    <div class="tool-grid three">
      <div><label for="fa-l">Length</label><input id="fa-l" name="l" type="number" inputmode="decimal" min="0" step="any" value="${EX.l}"></div>
      <div><label for="fa-w">Width</label><input id="fa-w" name="w" type="number" inputmode="decimal" min="0" step="any" value="${EX.w}"></div>
      <div><label for="fa-h">Height</label><input id="fa-h" name="h" type="number" inputmode="decimal" min="0" step="any" value="${EX.h}"></div>
    </div>
    <label for="fa-unit">Units</label><select id="fa-unit" name="unit"><option value="cm" selected>cm</option><option value="in">inches</option></select>
  </fieldset>
  <div class="tool-grid">
    <div><label for="fa-flow">Fan flow</label><input id="fa-flow" name="flow" type="number" inputmode="decimal" min="0" step="any" value="${EX.flow}"></div>
    <div><label for="fa-flow-unit">Flow units</label><select id="fa-flow-unit" name="flowUnit"><option value="cfm" selected>CFM</option><option value="m3h">m³/h</option><option value="lpm">L/min</option></select></div>
  </div>
  <div class="tool-grid">
    <div><label for="fa-run">Fan runs for (seconds)</label><input id="fa-run" name="run" type="number" inputmode="numeric" min="0" step="1" value="${exFruit.fan.run}"></div>
    <div><label for="fa-every">Every (minutes)</label><input id="fa-every" name="every" type="number" inputmode="numeric" min="0" step="1" value="${exFruit.fan.every}"></div>
  </div>
  <p class="muted tool-note">The fan cycle fills in from the profile when you change the mushroom or stage. Use the flow printed on your fan's label or spec sheet.</p>
</form>`,
  result: () => airResult(exampleSpecies, exFruit, exLiters, exAir),
  sections: [
    {
      h2: "How do you work out air changes per hour?",
      html: `<p>One air change moves as much air as the chamber holds. Multiply the fan's flow by the share of each hour it runs, then divide by the chamber volume.</p>
<p class="formula">Air changes per hour = fan flow per hour × (seconds on ÷ seconds in each cycle) ÷ chamber volume</p>
<p>Worked example: a ${EX.l} × ${EX.w} × ${EX.h} cm chamber holds ${round(exLiters, 0)} L. A fan rated at ${EX.flow} CFM moves ${round(flowLpm(EX.flow, EX.flowUnit), 0)} L a minute. Running ${exFruit.fan.run} s every ${exFruit.fan.every} min, the ${link("pearl-oyster")} fruiting cycle, it moves ${round(exAir.perRunLiters, 0)} L per run, about ${round(exAir.perHour, 1)} air changes an hour.</p>
<p>A fan rarely moves its full rated flow once it pushes through a filter or a small vent, and air does not mix perfectly, so treat the result as the most fresh air you could be getting.</p>`,
    },
    {
      h2: "How many air changes an hour do mushrooms need?",
      html: `<p>The University of California grower guide lists ${REFERENCE_ACH.low} fresh air exchanges an hour while oyster pins form and ${REFERENCE_ACH.low} to ${REFERENCE_ACH.high} an hour while they crop, with carbon dioxide under 600 ppm, and none during spawn run (<a href="${UCANR}" rel="nofollow noopener">UC ANR</a>). A SARE funded oyster guide says to keep carbon dioxide under 800 ppm and to replace all the air at least every 10 minutes in a fruiting room, and that above about 1,200 ppm oysters may not fruit at all (<a href="${SARE}" rel="nofollow noopener">SARE and FungiAlly</a>).</p>
<p>Those numbers are for rooms full of blocks. A small chamber with one block makes far less carbon dioxide, so it can do well with fewer changes. Use the reference as a starting point and let the mushrooms tell you the rest: long stems and small caps mean more air, dry or cracked caps mean more humidity.</p>`,
    },
    {
      h2: "Does more fresh air lower humidity?",
      html: `<p>Yes. Fresh air from a room is almost always drier than the air in a fruiting chamber, so every air change pulls humidity down for a while. That is why the profiles run the fan in short bursts and give humidity time to recover. If more air leaves caps dry, mist more often or add a humidifier instead of cutting the air. Read <a href="/guides/humidity-and-fresh-air">how much humidity and fresh air mushrooms need</a> for the signs of each.</p>`,
    },
    {
      h2: "What humidity and fan cycle does each mushroom use?",
      html: table(
        "Fruiting humidity and fan cycle from each profile",
        ["Mushroom", "Fruiting humidity", "Fan cycle"],
        SPECIES.map((s) => {
          const f = s.stages.find((x) => x.id === "fruiting");
          return `<tr><th scope="row">${link(s.id)}</th><td>${f.rh}%</td><td>${f.fan.run} s every ${f.fan.every} min</td></tr>`;
        })
      ),
    },
  ],
  faq: [
    { q: "How do you calculate air changes per hour for a grow chamber?", a: "Multiply the fan flow per hour by the share of time the fan runs, then divide by the chamber volume. One air change moves as much air as the chamber holds." },
    { q: "How many fresh air changes do oyster mushrooms need?", a: `A University of California grower guide lists ${REFERENCE_ACH.low} an hour while pins form and ${REFERENCE_ACH.low} to ${REFERENCE_ACH.high} an hour while fruiting, with carbon dioxide under 600 ppm.` },
    { q: "Does fresh air lower humidity in a mushroom chamber?", a: "Yes. Room air is drier than fruiting air, so each air change lowers humidity for a while. Short fan bursts give humidity time to recover." },
    { q: "What are signs of too little fresh air?", a: "Long stems, small caps, and oyster clusters that look like coral or trumpets. More fresh air fixes it." },
  ],
  related: [
    ["How much humidity and fresh air do mushrooms need?", "/guides/humidity-and-fresh-air"],
    ["Leggy mushroom stems", "/guides/leggy-mushroom-stems"],
    ["Grow timeline calculator", "/tools/grow-timeline"],
    ["Mushroom grow kit not growing", "/guides/mushroom-grow-kit-not-growing"],
  ],
};


/* ---------- substrate calculator ---------- */

export const SUBSTRATE_SOURCES = {
  "cvg-rhizo": ["Rhizo Funga, The best CVG recipe", "https://rhizofunga.com/blogs/mushroom-teks-recipes/best-cvg-recipe"],
  "cvg-ez": ["EZMushroom, Coco coir (CVG) substrate recipe", "https://ezmushroom.com/grow/coco-coir-cvg-substrate-recipe/"],
  freshcap: ["FreshCap Mushrooms, Growing mushrooms on soy hulls (the Master's Mix)", "https://freshcap.com/blogs/growing/growing-mushrooms-on-soy-hulls-the-masters-mix"],
  pennstate: ["Penn State Department of Plant Pathology, Specialty mushroom production technology", "https://plantpath.psu.edu/about/facilities/mushroom/resources/specialty-mushrooms/production-technology"],
  "ucanr-sawdust": ["UC Agriculture and Natural Resources, Sawdust and straw as substrate", "https://ucanr.edu/sites/default/files/2011-06/111961.pdf"],
  ufifas: ["University of Florida IFAS Extension, D.I.Y. FunGuide: Grow your own oyster mushrooms at home (SS662)", "https://doi.org/10.32473/edis-ss662-2018"],
  grocycle: ["GroCycle, Growing mushrooms in coffee grounds", "https://grocycle.com/growing-mushrooms-in-coffee-grounds/"],
};

const exSub = byIdSubstrate("cvg");
const exPlan = substratePlan(exSub, batchWet(exSub), exSub.spawn.default);
const recipeRows = SUBSTRATES.map((s) => {
  const total = batchWet(s);
  const dry = s.dry.map((d) => `${Math.round((d.g / total) * 100)}% ${d.name.toLowerCase()}`).join(", ");
  return `<tr><th scope="row">${esc(s.short)}</th><td>${dry}${s.gypsum ? `, ${Math.round((s.gypsum / total) * 100)}% gypsum` : ""}${s.water ? `, ${Math.round((s.water / total) * 100)}% water` : ""}</td><td>${s.spawn.low === s.spawn.high ? s.spawn.low : `${s.spawn.low} to ${s.spawn.high}`}%</td><td>${s.species.map((id) => link(id)).join(", ")}</td></tr>`;
});

const substrateCalc = {
  slug: "substrate-calculator",
  script: "/js/tools.js",
  sources: SUBSTRATE_SOURCES,
  title: "Mushroom substrate calculator: CVG, Master's Mix, sawdust, straw, coffee",
  h1: "Mushroom substrate and spawn calculator",
  description: "Enter a tub size or a target weight, pick CVG, Master's Mix, hardwood sawdust, straw, or coffee grounds, and get dry ingredients, water, gypsum, and spawn.",
  answer: `Pick a substrate, enter your container size or the wet weight you want, and set a spawn rate. The calculator scales a published recipe to give you each dry ingredient, the water to reach field capacity, the gypsum, and the grain spawn to mix in. One standard CVG batch, a 650 g coir brick, makes about ${gramsText(batchWet(exSub))} of wet substrate.`,
  form: () => `<form class="tool-form card" id="tool-form" data-tool="substrate-calculator" novalidate>
  <label for="sc-sub">Substrate</label>
  <select id="sc-sub" name="substrate">${SUBSTRATES.map((s) => `<option value="${s.id}"${s.id === exSub.id ? " selected" : ""}>${esc(s.name)}</option>`).join("")}</select>
  <fieldset class="tool-choice">
    <legend>Size by</legend>
    <label class="toggle"><input type="radio" name="by" value="weight" checked> Target wet substrate weight</label>
    <label class="toggle"><input type="radio" name="by" value="container"> Container or tub size</label>
  </fieldset>
  <div class="tool-grid" data-by="weight">
    <div><label for="sc-wet">Wet substrate weight</label><input id="sc-wet" name="wet" type="number" inputmode="decimal" min="0" step="any" value="${(batchWet(exSub) / 1000).toFixed(2)}"></div>
    <div><label for="sc-wet-unit">Units</label><select id="sc-wet-unit" name="wetUnit"><option value="kg" selected>kg</option><option value="lb">lb</option></select></div>
  </div>
  <div class="tool-grid three" data-by="container" hidden>
    <div><label for="sc-vol">Container size</label><input id="sc-vol" name="vol" type="number" inputmode="decimal" min="0" step="any" value="60"></div>
    <div><label for="sc-vol-unit">Units</label><select id="sc-vol-unit" name="volUnit"><option value="l" selected>liters</option><option value="qt">quarts</option><option value="gal">gallons</option></select></div>
    <div><label for="sc-fill">Fill to (%)</label><input id="sc-fill" name="fill" type="number" inputmode="numeric" min="1" max="100" step="1" value="25"></div>
  </div>
  <label for="sc-spawn">Spawn rate (% of wet substrate)</label>
  <input id="sc-spawn" name="spawn" type="number" inputmode="decimal" min="0" max="100" step="any" value="${exSub.spawn.default}">
  <p class="muted tool-note">Container sizing uses a rough packed density for each substrate. A monotub is usually filled 10 to 13 cm (4 to 5 in) deep, about a quarter of a 60 L tub. Weigh your first batch and switch to weight.</p>
</form>`,
  result: () => substrateResult(exPlan, SPECIES),
  sections: [
    {
      h2: "How does the substrate calculator work?",
      html: `<p>Each substrate starts from one published batch, listed in the sources. The calculator scales every ingredient by the same factor so the batch weighs what you asked for when wet. Spawn is added on top as a percent of the wet substrate weight.</p>
${table("Recipes by share of the wet batch weight", ["Substrate", "Recipe", "Spawn rate", "Grow profiles"], recipeRows)}`,
    },
    {
      h2: "What is field capacity?",
      html: `<p>Field capacity is as much water as the substrate can hold without free water pooling. Squeeze a handful hard: a few drops should come out, not a stream. Too wet is the most common cause of slow colonization and bacterial blotch, so add the last of the water slowly. Supplemented sawdust and Master's Mix sit near 60% moisture and drained straw near 65%.</p>`,
    },
    {
      h2: "Which substrate should I use?",
      html: `<p>For oysters, straw and coffee grounds are cheap and need only pasteurizing. Master's Mix and supplemented sawdust give bigger harvests of wood lovers like ${link("lions-mane")}, ${link("shiitake")}, and ${link("chestnut")}, but they must be pressure sterilized, which needs a pressure cooker and clean work. CVG is easy to pasteurize in a bucket and is the usual monotub bulk substrate.</p>`,
    },
    {
      h2: "How much spawn should I use?",
      html: `<p>Extension guides give 5 to 10% of the wet weight for straw and sawdust. Home growers often use 10 to 20% in CVG and Master's Mix. More spawn colonizes faster and leaves less time for mold, at a higher cost. GroCycle uses 10% of the coffee weight for coffee grounds.</p>`,
    },
  ],
  faq: [
    { q: "How much water do I add to CVG?", a: `The common batch is one 650 g coir brick, about 2 quarts (1.9 L) of vermiculite, 1 cup of gypsum, and about 4.25 L of boiling water. Hold some water back and finish with the squeeze test.` },
    { q: "What is the Master's Mix ratio?", a: "Equal dry weights of hardwood sawdust and soybean hulls, hydrated to about 60% moisture. For a 2.3 kg (5 lb) block that is 453 g of each and 1.4 L of water, then 2.5 hours at 15 PSI." },
    { q: "What spawn rate should I use for straw?", a: "University of Florida IFAS Extension gives 5 to 10% of the drained wet straw weight. 10% colonizes faster." },
    { q: "Do I need gypsum?", a: "CVG recipes use about 1 cup per 650 g brick and supplemented sawdust uses about 1%. Straw and coffee grounds do not need it, and Master's Mix works without it." },
    { q: "Can I pasteurize Master's Mix or bran?", a: "No. Soy hulls and bran are rich enough that molds win unless the substrate is pressure sterilized. Pasteurize only straw, CVG, and fresh coffee grounds." },
  ],
  related: [
    ["Grow timeline calculator", "/tools/grow-timeline"],
    ["Fresh air and humidity planner", "/tools/fresh-air-planner"],
    ["Mushroom growing conditions for every species", "/grow"],
    ["All free grow tools", "/tools"],
  ],
};

export const TOOL_PAGES = [substrateCalc, growTimeline, freshAir].map((t) => ({ ...t, updated: TOOLS_UPDATED, path: `/tools/${t.slug}` }));
