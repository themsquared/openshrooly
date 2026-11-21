/**
 * AI pages: the /ai hub and its spokes under /ai/. How Shroom Labs uses AI for growing
 * culinary mushrooms, feature by feature, plus a few question pages people actually search.
 *
 * Rules for this file (checked by api/test/ai-pages.test.js):
 * - Only what the code and docs show. Numbers come from the profiles or from constants that
 *   the test compares with the API source, so a code change that drifts from this copy fails CI.
 * - No ratings, test results, or testimonials. Anything not shipped is called in progress.
 * - Culinary only. Nothing here points at Off-menu profiles.
 * - Each question h2 is answered by its first sentence. Those become FAQPage markup.
 * - Plain words: no dashes, no arrows.
 */
import { FAN_BAND, FAN_CLAMP, FAN_ESCALATE_BAND, FAN_IN_BAND, FAN_STEP } from "../../../api/src/autopilot-knobs.js";
import { EVENT_KINDS, RANGES, SERIES } from "../../public/js/reading-chart.js";
import { FREE_IDS, days, link, profile, stage, temp } from "../guides/data.js";

export const AI_UPDATED = "2026-11-21";
export const CHECKED = "November 21, 2026";

const REPO = "https://github.com/themsquared/openshrooly";
const BLOB = `${REPO}/blob/cursor/community-platform-fa9c`;
const a = (href, text) => `<a href="${href}" rel="noopener">${text}</a>`;

export const SOURCES = {
  coachLearn: { label: "Grow Coach chamber model and recommendation rules (coach-learn.js)", url: `${BLOB}/community/api/src/coach-learn.js` },
  autopilot: { label: "Autopilot guardrails and pause rules (coach-autopilot.js)", url: `${BLOB}/community/api/src/coach-autopilot.js` },
  knobs: { label: "Autopilot stage, fan, fresh air and light rules (autopilot-knobs.js)", url: `${BLOB}/community/api/src/autopilot-knobs.js` },
  decider: { label: "Autopilot decision model: questions, confidence and step sizes", url: `${BLOB}/community/api/src/jev.js` },
  photo: { label: "Grow Coach photo check (coach-photo.js)", url: `${BLOB}/community/api/src/coach-photo.js` },
  chart: { label: "Readings chart: series, target bands and event markers (reading-chart.js)", url: `${BLOB}/community/web/public/js/reading-chart.js` },
  alerts: { label: "Shroom Labs alert rules, including water level (alert rules on GitHub)", url: `${BLOB}/docs/ALERTS.md` },
  devices: { label: "Device identity and opt-in cloud control (design notes on GitHub)", url: `${BLOB}/docs/DEVICES.md` },
  mcpDoc: { label: "Shroom Labs MCP server (notes on GitHub)", url: `${BLOB}/docs/MCP.md` },
  mcpSpec: { label: "Model Context Protocol specification", url: "https://modelcontextprotocol.io/specification" },
  openshrooly: { label: "OpenShrooly.com, project page by Graham Stewart", url: "https://openshrooly.com/" },
  upstream: { label: "grahamsz/openshrooly on GitHub (upstream firmware)", url: "https://github.com/grahamsz/openshrooly" },
  repo: { label: "themsquared/openshrooly on GitHub (Shroom Labs firmware, site and API)", url: REPO },
  lykynFirmware: { label: "Shroom Labs Lykyn firmware on GitHub", url: "https://github.com/themsquared/lykyn-firmware" },
  clinTox: {
    label: "Clinical Toxicology (2023): A comparison of the accuracy of mushroom identification applications using digital photographs",
    url: "https://www.tandfonline.com/doi/10.1080/15563650.2022.2162917",
  },
  npj: { label: "npj Science of Food (2026): AI-mediated risks and real-life challenges in mushroom foraging", url: "https://www.nature.com/articles/s41538-026-00752-4" },
  publicCitizen: {
    label: "Public Citizen (2024): Mushrooming Risk, unreliable A.I. tools generate mushroom misinformation (PDF)",
    url: "https://www.citizen.org/wp-content/uploads/ai-mushroom-apps-risk-misinformation-report-2024.pdf",
  },
  poison: { label: "National Capital Poison Center: Poison Control and the Poison Help line", url: "https://www.poison.org/" },
};

const cite = (key, text) => a(SOURCES[key].url, text || SOURCES[key].label.split(" (")[0]);

/**
 * Autopilot and Coach limits quoted on these pages. api/test/ai-pages.test.js checks every value
 * against AUTOPILOT_LIMITS, SAFE_BOUNDS, JEV_POLICY and the heartbeat in the API source.
 */
export const FACTS = {
  autopilotTemp: [10, 32],
  autopilotRh: [60, 98],
  maxStepTemp: 1,
  maxStepRh: 3,
  maxStepFan: 10,
  minIntervalHours: 1,
  dailyCap: 8,
  commandTtlMin: 35,
  staleMin: 20,
  physicalTemp: [0, 45],
  physicalRh: [10, 100],
  jumpTemp: 8,
  jumpRh: 25,
  coachRh: [70, 96],
  coachTemp: [10, 32],
  coachRhDelta: 6,
  coachTempDelta: 2,
  minConfidence: 0.6,
  abnormalPause: 0.85,
  steps: { temperature_c: 0.5, humidity_percent: 2, fan_speed_percent: 10, white_intensity: 50 },
  lightBandPercent: 50,
  heartbeatMin: 15,
  waterLow: 30,
  waterEmpty: 12,
  humidityTroublePts: 8,
  stalledColonizationPercent: 70,
  stalledHumidityPts: 5,
  harvestPercent: 90,
};

const table = (caption, heads, rows) =>
  `<div class="table-wrap"><table class="conditions-table"><caption>${caption}</caption><thead><tr>${heads
    .map((h) => `<th scope="col">${h}</th>`)
    .join("")}</tr></thead><tbody>${rows.map((r) => `<tr><th scope="row">${r[0]}</th>${r.slice(1).map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;

/** Species used in the profile tables. Only free culinary profiles that exist. */
const TABLE_SPECIES = ["pearl-oyster", "blue-oyster", "pink-oyster", "lions-mane", "shiitake", "king-oyster", "chestnut"].filter((id) => FREE_IDS.includes(id));

const pm = (center, hyst, unit) => (Number(hyst) ? `${center}${unit} ± ${hyst}${unit === "%" ? " points" : unit}` : `${center}${unit}`);

function fruitingRows() {
  return TABLE_SPECIES.map((id) => {
    const s = stage(id, "fruiting");
    const fan = s.fan || {};
    return [link(id), temp(s.temperature_c), pm(s.humidity_percent, s.humidity_hysteresis, "%"), `${fan.run_duration_s} s every ${fan.period_min} min at ${fan.speed_percent}%`];
  });
}

function humidityRows() {
  return TABLE_SPECIES.map((id) => {
    const s = stage(id, "fruiting");
    const rh = Number(s.humidity_percent);
    const h = Number(s.humidity_hysteresis || 0);
    const fan = s.fan || {};
    return [link(id), `${rh}%`, h ? `below ${rh - h}%, off above ${rh + h}%` : `at ${rh}%`, `${fan.run_duration_s} s every ${fan.period_min} min`];
  });
}

const kindRows = () => {
  const seen = new Set();
  return Object.values(EVENT_KINDS)
    .filter((k) => (seen.has(k.name) ? false : seen.add(k.name)))
    .map((k) => [k.letter, k.name.replace(/^Setpoint change$/, "Target change")]);
};

const SPOKE_LINKS = [
  ["Grow Coach", "/ai/grow-coach"],
  ["Autopilot", "/ai/autopilot"],
  ["Photo check and readings charts", "/ai/photo-check-and-charts"],
  ["Open firmware", "/ai/open-firmware"],
  ["MCP server for AI assistants", "/ai/mcp-server"],
];

/* ----------------------------------------------------------------------------- hub */

const hub = {
  slug: "",
  path: "/ai",
  og: "ai",
  title: "Connect your mushroom grow box to AI: Grow Coach and Autopilot",
  h1: "Connect your mushroom grow to AI",
  crumb: "AI",
  eyebrow: "Connect your grow to AI",
  updated: AI_UPDATED,
  description: "Connect a Shrooly or Lykyn to AI: flash free firmware, link the chamber, and Grow Coach reads it and can adjust it inside hard limits.",
  answer:
    "You connect a mushroom chamber to AI in three steps: flash free Shroom Labs firmware on a Shrooly or Lykyn, link it to a free account, and start Grow Coach. From there, Shroom Labs uses AI in a few narrow places: Grow Coach compares a chamber's live readings with the grow profile for your species and recommends changes, Autopilot makes those changes in small steps inside limits written in code, and a photo check reads a picture of your grow. The target numbers come from researched grow profiles, not from a model, and the chamber firmware is open source and keeps growing on its own if the internet or our site goes down.",
  cta: [["Grow Coach", "/coach"], ["Install on your Shrooly", "/install"], ["Chambers that work", "/chambers"]],
  sources: ["coachLearn", "autopilot", "decider", "photo", "chart", "mcpDoc", "openshrooly", "repo"],
  related: [["Mushroom growing conditions for every species", "/grow"], ["Shroom Labs grow log", "/grow-log"], ["Fresh air planner", "/tools/fresh-air-planner"]],
  sections: [
    {
      h2: "How do I connect my mushroom chamber to AI?",
      answer: "Flash free Shroom Labs firmware on your Shrooly or Lykyn, link the chamber to a free Shroom Labs account, then start a Grow Coach plan.",
      html: `<ol>
<li><strong>Flash the firmware.</strong> A Shrooly installs from <a href="/install">the browser installer</a> with Chrome or Edge and a USB-C data cable in about 5 minutes. A Lykyn is flashed from the public firmware repo; read <a href="/lykyn">Lykyn for mushrooms</a> first and back up the stock image.</li>
<li><strong>Link the chamber.</strong> <a href="/claim">Link it to your account</a> so its readings reach Shroom Labs. The chamber keeps working on your Wi-Fi either way.</li>
<li><strong>Start Grow Coach.</strong> <a href="/coach">Grow Coach</a> reads those readings, recommends changes for your species, and with Autopilot makes them for you.</li>
</ol><p>Flashing alone does not connect the chamber to Grow Coach: the AI part starts only when you link the chamber and turn on Coach.</p>`,
    },
    {
      h2: "What does the AI actually do in a Shroom Labs chamber?",
      answer: "It watches, explains, and nudges: Grow Coach reads the chamber, Autopilot adjusts targets, and the photo check looks at your block.",
      html: `${table(
        "Where AI is used on Shroom Labs",
        ["Feature", "What it does", "Who decides the numbers"],
        [
          [`<a href="/ai/grow-coach">Grow Coach</a>`, "Compares live readings with your species profile, keeps track of how your chamber behaves, recommends changes with a reason, sends alerts, and answers questions.", "The profile and fixed safe bounds. The chamber model is plain math."],
          [`<a href="/ai/autopilot">Autopilot</a>`, "Makes Coach's changes for you, picks the stage from the grow day, and logs every decision with the reason.", `Code. A small model only answers raise, hold or lower, and code clamps every step.`],
          [`<a href="/ai/photo-check-and-charts">Photo check</a>`, "Reads a phone photo of your grow next to the chamber's readings and suggests next steps.", "Advice only. It changes nothing on the chamber."],
          [`<a href="/ai/photo-check-and-charts">Readings charts</a>`, "Shows temperature, humidity, fan and water with target bands and a marker for every change.", "No AI. A plain record of what happened."],
          [`<a href="/ai/mcp-server">MCP server</a>`, "Lets AI assistants look up grow profiles and guides and cite them.", "Read only. It never touches a chamber."],
        ]
      )}<p>Underneath all of it is <a href="/ai/open-firmware">open firmware</a> that runs the mister, fans and light locally. AI only ever sends new targets to it.</p>`,
    },
    {
      h2: "What does the AI not do?",
      answer: "It does not invent targets, it does not run the chamber's basic control loop, and it does not identify wild mushrooms.",
      html: `<ul>
<li><strong>No made up numbers.</strong> Targets start from the grow profile for the species and stage you picked. Autopilot moves them one small fixed step at a time and code clamps the result. See <a href="/ai/autopilot">the limits</a>.</li>
<li><strong>No hidden control.</strong> The chamber's own firmware holds humidity, fresh air and light. If our site is down, it keeps going on its last targets.</li>
<li><strong>No species identification.</strong> The photo check assumes you know what you are growing. For wild mushrooms, read <a href="/ai/can-ai-identify-mushrooms">can AI identify mushrooms safely</a>.</li>
<li><strong>Culinary only.</strong> Grow Coach, Autopilot and the photo check refuse anything that is not a culinary grow.</li>
</ul>`,
    },
    {
      h2: "Which chambers can use Grow Coach and Autopilot?",
      answer: "A Shrooly running OpenShrooly and a Lykyn running Shroom Labs firmware, once you link the chamber to your account.",
      html: `<p>Both run on real hardware and are marked supported on the <a href="/chambers">chambers page</a>. Terrashroom firmware and the AC Infinity adapter exist but are untested on real hardware, so only Shrooly and Lykyn are marked supported. Any other chamber, tub or tent can still use the free <a href="/grow">grow profiles</a> by hand.</p>`,
    },
    {
      h2: "Do I need AI to grow mushrooms with Shroom Labs?",
      answer: "No. The grow profiles and firmware are free, and a chamber runs fine on its own without an account or Grow Coach.",
      html: `<p>There are ${FREE_IDS.length} free culinary profiles, each with temperature, humidity, fresh air and light for every stage. Load one and the chamber follows it. Grow Coach adds a second set of eyes for people who want the chamber to adjust itself over a long grow. If you are new, start with <a href="/ai/can-ai-grow-mushrooms">can AI grow mushrooms</a> for an honest look at what it adds.</p>`,
    },
    {
      h2: "What does it cost?",
      answer: "Grow Coach, which includes Autopilot and the photo check, is a paid monthly or yearly plan; the firmware, free profiles, charts and MCP server cost nothing.",
      html: `<p>You can cancel Grow Coach anytime from your account. Current prices are on the <a href="/coach">Grow Coach page</a>.</p>`,
    },
    {
      h2: "How is the AI kept from making a bad change?",
      answer: "Every limit lives in code the model cannot change: small fixed steps, at most one change an hour and eight a day, hard temperature and humidity ranges, and an automatic pause when readings look stale or broken.",
      html: `<p>The full list, with the numbers, is on the <a href="/ai/autopilot">Autopilot page</a>. Each change also lands in a decisions feed with who made it and why, and you can undo it.</p>`,
    },
  ],
};

/* ----------------------------------------------------------------------------- spokes */

const growCoach = {
  slug: "grow-coach",
  og: "ai-grow-coach",
  title: "Grow Coach: AI mushroom grow coach with per-species advice",
  h1: "Grow Coach: per-species advice from your chamber's own readings",
  crumb: "Coach advice",
  eyebrow: "Connect your grow to AI",
  updated: AI_UPDATED,
  description: "Grow Coach compares your chamber's live readings with the culinary profile for your species, keeps track of how your chamber behaves, and explains each change.",
  answer: `Grow Coach reads your chamber's live temperature, humidity and fan readings, compares them with the stage targets in the culinary profile you picked, and tells you what to change and why. It also keeps a running picture of how your particular chamber behaves, such as whether it lags its humidity target, and answers questions about your grow in plain words. It is a paid plan you can cancel anytime.`,
  cta: [["Start Grow Coach", "/coach"], ["Link a chamber", "/claim"], ["See Autopilot", "/ai/autopilot"]],
  sources: ["coachLearn", "autopilot", "photo", "repo"],
  related: [["Mushroom growing conditions for every species", "/grow"], ["Humidity and fresh air", "/guides/humidity-and-fresh-air"]],
  sections: [
    {
      h2: "How does Grow Coach decide what to recommend?",
      answer: "It compares the latest reading with the profile's target band for the current stage and with your chamber's own track record over the last day, then writes a recommendation with the reason attached.",
      html: `<p>The track record is a small per chamber model built from recent readings. It is plain math, not a language model:</p>
<ul>
<li><strong>Humidity error and droop.</strong> How far humidity sits from its target on average, and whether it tends to fall short.</li>
<li><strong>Temperature offset.</strong> How far the chamber runs warm or cool against its target.</li>
<li><strong>Humidity rise rate.</strong> How fast humidity climbs, which shows whether the mister keeps up.</li>
<li><strong>Water use and average fan speed.</strong> From the chamber's own reports.</li>
<li><strong>Your grow outcomes.</strong> How often your past culinary grows on that chamber went well.</li>
</ul>
<p>A useful detail: when humidity is off, Coach leaves the humidity target at the profile value and works on fresh air instead of chasing the humidity number up and down. A warm or cool reading outside the profile's temperature band gets a plain instruction, such as lowering the target back toward the profile value. Only a real sensor calibration value can shift the suggested temperature, and never outside the profile's band. Source: ${cite("coachLearn")}.</p>`,
    },
    {
      h2: "Why does each species get different advice?",
      answer: "Because every culinary profile has its own targets for each stage, and Grow Coach measures your chamber against the profile you picked, not a generic number.",
      html: `${table(`Fruiting targets Grow Coach checks against, from the free profiles`, ["Mushroom", "Temperature", "Humidity", "Fresh air"], fruitingRows())}
<p>So the same 85% reading can be fine for one species and too dry for another. Every profile page in the <a href="/grow">grow guides</a> lists the other stages too.</p>`,
    },
    {
      h2: "What alerts does Grow Coach send?",
      answer: `Three grow alerts: humidity trouble when it misses the target by ${FACTS.humidityTroublePts} points or more on average, colonization that looks stalled, and a heads up when the fruiting window is nearly over.`,
      html: `<ul>
<li><strong>Humidity trouble.</strong> Humidity misses the target by a wide margin. The message tells you to check the reservoir and the door seal.</li>
<li><strong>Stalled colonization.</strong> More than ${FACTS.stalledColonizationPercent}% of the colonization stage has passed, humidity sits more than ${FACTS.stalledHumidityPts} points under its target, and it is not climbing.</li>
<li><strong>Time to harvest.</strong> ${FACTS.harvestPercent}% of the fruiting stage has passed. Check cap size and harvest if veils are thinning.</li>
</ul>
<p>Account alerts for water level and an offline chamber are separate and work without Grow Coach. See ${cite("alerts", "the alert rules")}.</p>`,
    },
    {
      h2: "Can I ask Grow Coach questions about my grow?",
      answer: "Yes. The chat answers in plain prose using your chamber's readings, its learned model, and the stage targets of the profile you selected.",
      html: `<p>Because it sees the same numbers you do, a question like "why are my pins drying out" gets an answer that mentions your actual humidity, not a textbook range. There is a daily limit on chats and photo checks so costs stay predictable. Questions about anything that is not a culinary grow are refused.</p>`,
    },
    {
      h2: "What will Grow Coach never do?",
      answer: `It never suggests humidity outside ${FACTS.coachRh[0]} to ${FACTS.coachRh[1]}% or temperature outside ${FACTS.coachTemp[0]} to ${FACTS.coachTemp[1]} °C, never moves more than ${FACTS.coachRhDelta} points of humidity or ${FACTS.coachTempDelta} °C from the profile, and never coaches anything but a culinary grow.`,
      html: `<p>Per stage warning bands in a profile tighten that range further. The bounds are in ${cite("coachLearn", "the Coach source")}, which is public. Grow Coach also does not identify species: it assumes you know what you are growing because you picked the profile.</p>`,
    },
    {
      h2: "Should I use Advisor or Autopilot?",
      answer: "Start with Advisor, where you approve each change with one tap, and switch to Autopilot once the reasons it gives make sense to you.",
      html: `<p>Autopilot makes the same kind of changes on its own, with extra limits on how often and how far. Read <a href="/ai/autopilot">how Autopilot works</a> first. You can switch back to Advisor anytime.</p>`,
    },
    {
      h2: "What do I need to use Grow Coach?",
      answer: "A Shrooly running OpenShrooly or a Lykyn running Shroom Labs firmware, linked to a Shroom Labs account, plus a Grow Coach plan.",
      html: `<p>Install OpenShrooly from the <a href="/install">install page</a> or read <a href="/lykyn">Lykyn for mushrooms</a>, then <a href="/claim">link the chamber</a>. The chamber reports in about every ${FACTS.heartbeatMin} minutes, and that is what Coach reads.</p>`,
    },
  ],
};

const autopilot = {
  slug: "autopilot",
  og: "ai-autopilot",
  title: "Autopilot for mushroom chambers: how it adjusts, and its limits",
  h1: "Autopilot: how the chamber adjusts itself, and the limits it cannot cross",
  crumb: "Autopilot",
  eyebrow: "Connect your grow to AI",
  updated: AI_UPDATED,
  description: "Autopilot sets temperature, humidity, fresh air, light and stage from your mushroom profile in small logged steps, inside hard limits, with undo.",
  answer: `Autopilot is the hands off mode of Grow Coach. It picks the profile stage from your grow day, sets fresh air and light from that stage's recipe, and nudges the temperature target, humidity target and fan speed in small steps, never more than one change an hour or ${FACTS.dailyCap} a day. Every change lands in a decisions feed with who decided and why, and you can undo it.`,
  cta: [["Turn on Autopilot in Grow Coach", "/coach"], ["Grow Coach", "/ai/grow-coach"]],
  sources: ["autopilot", "knobs", "decider", "chart", "repo"],
  related: [["Humidity and fresh air", "/guides/humidity-and-fresh-air"], ["Shroom Labs grow log", "/grow-log"]],
  sections: [
    {
      h2: "What can Autopilot change?",
      answer: "Temperature target, humidity target, fan speed, the fresh air schedule, the light schedule, light brightness and color, and the grow stage, but only the ones your chamber says it supports.",
      html: `<p>Chambers report a list of what they can take. Autopilot never sends a setting a chamber did not list, and older firmware that only takes temperature and humidity just gets those. Fresh air timing and the light schedule come straight from the stage recipe in the profile. Fan speed may move up to ${FAN_BAND} points from the recipe in steps of ${FAN_STEP}, always inside ${FAN_CLAMP[0]} to ${FAN_CLAMP[1]}%. Light brightness stays within ${FACTS.lightBandPercent}% of the recipe. Source: ${cite("knobs")}.</p>`,
    },
    {
      h2: "How does Autopilot know which stage the grow is in?",
      answer: "It counts grow days through the profile's stage lengths, so a profile with a 16 day colonization moves to pinning on day 17, and a stage you pick yourself always wins.",
      html: `<p>On chambers that report their phase, Autopilot can also move the chamber to the next stage when the day count says it is time.</p>`,
    },
    {
      h2: "What limits are hard coded?",
      answer: "Fixed ranges, fixed step sizes, and a fixed pace that the model cannot change.",
      html: table(
        "Autopilot limits in the source code",
        ["Limit", "Value"],
        [
          ["Temperature target range", `${FACTS.autopilotTemp[0]} to ${FACTS.autopilotTemp[1]} °C, plus the stage's guardrails`],
          ["Humidity target range", `${FACTS.autopilotRh[0]} to ${FACTS.autopilotRh[1]}%, plus the stage's guardrails`],
          ["Biggest single step", `${FACTS.maxStepTemp} °C, ${FACTS.maxStepRh} points of humidity, ${FACTS.maxStepFan} points of fan`],
          ["Time between changes", `At least ${FACTS.minIntervalHours} hour`],
          ["Changes per day", `At most ${FACTS.dailyCap}`],
          ["Unclaimed command", `Expires after ${FACTS.commandTtlMin} minutes, so an old change cannot land late`],
          ["Fan range", `${FAN_CLAMP[0]} to ${FAN_CLAMP[1]}%`],
        ]
      ) + `<p>Source: ${cite("autopilot")}.</p>`,
    },
    {
      h2: "Where does the AI come in?",
      answer: "On each pass a small decision model answers five narrow questions: raise, hold or lower for temperature, humidity, fan and light, plus whether the readings look broken.",
      html: `<p>The model sees the chamber's structured state only: profile, stage, grow day, the last 6 hours of readings in 30 minute buckets, current targets, the guardrails, and its own last few changes. It sees no free text and no personal data. Then code takes over:</p>
<ul>
<li>A raise or lower only counts at a confidence of ${FACTS.minConfidence} or higher. Below that, the plain rules decide that knob.</li>
<li>A confident answer moves exactly one fixed step: ${FACTS.steps.temperature_c} °C, ${FACTS.steps.humidity_percent} points of humidity, ${FACTS.steps.fan_speed_percent} points of fan, or ${FACTS.steps.white_intensity} units of white light.</li>
<li>The result still goes through every limit in the table above.</li>
<li>If the model is slow, errors, or answers in the wrong shape, that pass uses the rules.</li>
</ul>
<p>Hold is always the safe answer. Source: ${cite("decider")}.</p>`,
    },
    {
      h2: "How does Autopilot handle humidity and fresh air together?",
      answer: `It holds the fan step until humidity is within ${FAN_IN_BAND} point of target, and only reaches further when humidity stays off target for an hour without improving.`,
      html: `<p>Every fan run pulls moist air out, so a fan change can fight the mister. When humidity stays out of band and is not moving toward the target, Autopilot may step the fan up to ${FAN_ESCALATE_BAND} points from the recipe, still inside the fan range. More on the physics in <a href="/ai/smart-mushroom-grow-box-humidity-and-fresh-air">how a smart grow box automates humidity and fresh air</a>.</p>`,
    },
    {
      h2: "When does Autopilot pause itself?",
      answer: `When the chamber looks offline, readings are missing or older than ${FACTS.staleMin} minutes, a reading is physically impossible, or a reading jumps more than ${FACTS.jumpTemp} °C or ${FACTS.jumpRh} points of humidity from the last one.`,
      html: `<p>Physically impossible means outside ${FACTS.physicalTemp[0]} to ${FACTS.physicalTemp[1]} °C or ${FACTS.physicalRh[0]} to ${FACTS.physicalRh[1]}% humidity, which usually means a sensor problem. A short quiet spell just makes it wait. A bad sensor reading switches it back to Advisor. The decision model's broken readings question can do the same: at ${FACTS.abnormalPause} or above, Autopilot drops to Advisor, sends nothing to the chamber, and emails you if email alerts are on.</p>`,
    },
    {
      h2: "What is the decisions feed?",
      answer: "A newest first list of what Coach changed, who decided, and why, with an undo for each change.",
      html: `<p>The same decisions show as markers on the chamber's readings chart, so you can see a humidity dip and the change that followed it on one screen. See <a href="/ai/photo-check-and-charts">the readings charts</a>.</p>`,
    },
    {
      h2: "Can I still change settings by hand?",
      answer: "Not while Autopilot is on: the site locks climate, fresh air, light, stage and what is growing until you switch Coach back to Advisor.",
      html: `<p>That keeps two drivers from fighting over one chamber. The message you see is "Coach is managing targets. Turn Coach off to set them yourself."</p>`,
    },
  ],
};

const photoCharts = {
  slug: "photo-check-and-charts",
  og: "ai-photo-check-and-charts",
  title: "Mushroom grow photo check and live readings charts",
  h1: "Photo check and readings charts: seeing what the chamber sees",
  crumb: "Photo check and charts",
  eyebrow: "Connect your grow to AI",
  updated: AI_UPDATED,
  description: "Snap a phone photo of your mushroom grow for an AI check against the chamber's readings, and read live charts with target bands and change markers.",
  answer: `There is no camera inside a Shroom Labs chamber. You take a photo with your phone, and Grow Coach's photo check reads it next to the chamber's readings, then names the stage it sees, any issues and how sure it is, and two to four next steps. The readings charts show temperature, humidity, fan and water over ${RANGES.map((r) => r.label).join(", ")}, with the stage's target band and a marker for every Autopilot or Coach change.`,
  cta: [["Check a photo in Grow Coach", "/coach"], ["Grow Coach", "/ai/grow-coach"]],
  sources: ["photo", "chart", "repo"],
  related: [["Mushroom contamination", "/guides/mushroom-contamination"], ["Mushrooms not pinning", "/guides/mushrooms-not-pinning"]],
  sections: [
    {
      h2: "Does the chamber have a built in camera?",
      answer: "No. Shrooly and Lykyn chambers have no camera we use, so the photo check works from a photo you take with your phone.",
      html: `<p>A Terrashroom has a camera module on its board, but our community Terrashroom firmware does not support it yet. A phone photo is sharper anyway, and you choose the angle.</p>`,
    },
    {
      h2: "What does the photo check tell you?",
      answer: "A one or two sentence summary, the stage it sees, any issues with a severity, two to four next steps, and a confidence score.",
      html: `${table(
        "What a photo check returns",
        ["Field", "What it holds"],
        [
          ["Stage", "Colonizing, pinning, fruiting, ready to harvest, past harvest, or unclear"],
          ["Issues", "Each with a short name, one sentence, and a severity of low, medium or high"],
          ["Next steps", "Two to four short steps"],
          ["Confidence", "0 to 1, so you know how much weight to give it"],
        ]
      )}<p>If you pick a chamber, the check also sees its stage, grow day, targets and recent readings, and says so plainly when readings are off target. On possible mold it is told to say what it sees and how sure it is rather than guess. For a closer look at mold, read <a href="/guides/mushroom-contamination">mushroom contamination</a>. Source: ${cite("photo")}.</p>`,
    },
    {
      h2: "What happens to my photo?",
      answer: "It is not saved: location and camera details are stripped, the image is checked once, and then it is dropped.",
      html: `<p>Photos that do not look like a mushroom grow get a polite "try a closer shot" instead of advice, and grows that are not culinary are refused. If you want to show off a harvest, post it on the grow feed instead, where you choose to make it public.</p>`,
    },
    {
      h2: "What is on the readings chart?",
      answer: "Stacked panels on one time axis for each reading the chamber sends, the current stage's target band, a line for each target you set, gaps where the chamber was offline, and lettered markers for changes.",
      html: `${table(
        "Readings the chart shows when the chamber reports them",
        ["Reading", "Unit"],
        SERIES.map((s) => [s.name, s.unit || "°C or °F"])
      )}${table("Change markers on the chart", ["Marker", "Meaning"], kindRows())}<p>CO2 only shows when a chamber reports it, and today's chambers do not. Source: ${cite("chart")}.</p>`,
    },
    {
      h2: "How do the charts help find a problem?",
      answer: "Look for a reading that sits outside its shaded target band while the target you set is right, because that means the chamber cannot keep up rather than being set wrong.",
      html: `<ul>
<li><strong>Humidity under the band while its target is right.</strong> Check the reservoir and the door seal before changing anything.</li>
<li><strong>A gap in the lines.</strong> The chamber stopped reporting. Autopilot pauses during gaps.</li>
<li><strong>A marker right before a change in the line.</strong> Hover it to see whether Autopilot, a Coach suggestion, a profile or stage pick, or a firmware update caused it.</li>
</ul>`,
    },
    {
      h2: "Can the photo check identify a wild mushroom?",
      answer: "No. It is built for a culinary grow you already know the species of, and it should never be used to decide whether a wild mushroom is safe to eat.",
      html: `<p>Read <a href="/ai/can-ai-identify-mushrooms">can AI identify mushrooms safely</a> for what the research says about identification apps.</p>`,
    },
  ],
};

const openFirmware = {
  slug: "open-firmware",
  og: "ai-open-firmware",
  title: "Open source mushroom chamber firmware for Shrooly and Lykyn",
  h1: "Open firmware for Shrooly and Lykyn: AI on top, local control underneath",
  crumb: "Open firmware",
  eyebrow: "Connect your grow to AI",
  updated: AI_UPDATED,
  description: "OpenShrooly and Shroom Labs Lykyn firmware run humidity, fresh air and light locally. Grow Coach only sends targets over an optional, outbound cloud link.",
  answer: "Both supported chambers run open source firmware: OpenShrooly on the Shrooly and Shroom Labs firmware on the Lykyn. The firmware holds humidity, fresh air and light on its own, on your Wi-Fi, with no account. Grow Coach and Autopilot only send new targets through an optional, outbound cloud link, so the chamber keeps growing if that link or our site goes down.",
  cta: [["Install on your Shrooly", "/install"], ["Lykyn firmware", "/lykyn"], ["Code on GitHub", REPO]],
  sources: ["openshrooly", "upstream", "repo", "lykynFirmware", "devices"],
  related: [["Reuse your Shrooly", "/reuse-your-shrooly"], ["What happened to Shrooly?", "/what-happened-to-shrooly"], ["Mushroom chambers that work with Shroom Labs", "/chambers"]],
  sections: [
    {
      h2: "Why does open firmware matter for an AI grow chamber?",
      answer: "Because you can read exactly what runs your chamber, and the part that keeps your mushrooms alive never depends on a model or a server.",
      html: `<p>The firmware runs the control loop: it reads the sensor, switches the mister, cycles the fans and runs the light schedule. Grow Coach sits on top and can only change targets. Chambers whose company app stopped working are the reason this project exists, so local control comes first.</p>`,
    },
    {
      h2: "What runs on a Shrooly?",
      answer: "OpenShrooly, free open source firmware started by Graham Stewart, which Shroom Labs builds on, signs, and installs from the browser in about 5 minutes.",
      html: `<p>You need Chrome or Edge on a computer and a USB-C data cable. The browser checks the release signature before anything is sent to the chamber, and later updates install over Wi-Fi and are checked the same way. Upstream code: ${cite("upstream", "grahamsz/openshrooly")}. Start at the <a href="/install">install page</a>.</p>`,
    },
    {
      h2: "What runs on a Lykyn?",
      answer: "Native Shroom Labs firmware on the Lykyn's ESP32-C3, validated on a real unit, with a local dashboard, an optional cloud link, grow profiles and Grow Coach.",
      html: `<p>The Lykyn has an SHT3x temperature and humidity sensor, two PWM fans, an ultrasonic mister and a 16 pixel grow ring, and no heater or cooler, so temperature targets are tracked rather than forced. Back up the stock image before you flash and do not erase the flash. Details on <a href="/lykyn">Lykyn for mushrooms</a> and in the ${cite("lykynFirmware", "firmware repo")}.</p>`,
    },
    {
      h2: "What does the cloud link send and receive?",
      answer: "The chamber sends its readings and a list of what it can do; it receives targets, profiles and schedules, and answers each command with applied or refused.",
      html: `<p>The link is opt-in and outbound: the chamber calls out to the Shroom Labs API, nothing calls in. A linked chamber proves who it is with a secret it creates on its own chip, and that secret never leaves the chip, so a copied log line cannot impersonate your chamber. You can turn the link off in the chamber's settings. Design notes: ${cite("devices")}.</p>`,
    },
    {
      h2: "What happens when the internet or Shroom Labs goes down?",
      answer: "The chamber keeps running its current targets locally, and Autopilot pauses until fresh readings arrive.",
      html: `<p>Pending Autopilot commands expire after ${FACTS.commandTtlMin} minutes, so a backlog cannot pile up and land all at once when the link returns. You can still use the chamber's buttons and its local web page on your network.</p>`,
    },
    {
      h2: "Can I use Home Assistant instead of the cloud?",
      answer: "Yes. A chamber running OpenShrooly stays fully usable on your network, including from Home Assistant, with no account and no cloud link.",
      html: `<p>You would then run the grow profile numbers yourself or with your own automations. Grow Coach needs the cloud link because it reads the chamber's history.</p>`,
    },
  ],
};

const mcp = {
  slug: "mcp-server",
  og: "ai-mcp-server",
  title: "Mushroom growing MCP server for AI assistants (free, read only)",
  h1: "Ask your AI assistant about mushrooms with the Shroom Labs MCP server",
  crumb: "MCP server",
  eyebrow: "Connect your grow to AI",
  updated: AI_UPDATED,
  description: "A free, read only MCP server at api.shroomlabs.io/mcp lets AI assistants look up mushroom grow profiles, stage conditions, timelines and guides.",
  answer: "Shroom Labs runs a free, read only MCP server at https://api.shroomlabs.io/mcp. AI assistants that support the Model Context Protocol can use it to look up culinary grow profiles, stage by stage conditions, grow timelines and our guides, then link the page they used. It needs no account or sign in and cannot touch a chamber.",
  cta: [["Grow profiles", "/grow"], ["MCP notes on GitHub", SOURCES.mcpDoc.url]],
  sources: ["mcpDoc", "mcpSpec", "repo"],
  related: [["Grow timeline calculator", "/tools/grow-timeline"], ["How long do mushrooms take to grow?", "/guides/how-long-to-grow-mushrooms"]],
  sections: [
    {
      h2: "What can an assistant look up through the MCP server?",
      answer: "Five read only tools: list profiles, get one profile, search grow content, get a chamber guide, and build a grow timeline.",
      html: table(
        "Shroom Labs MCP tools",
        ["Tool", "What it returns"],
        [
          ["list_profiles", "Culinary grow profiles with slug, species, total days and page URL, with an optional text filter"],
          ["get_profile", "One profile: every stage with days, temperature in °C and °F, humidity, fresh air, light hours, chamber tips and sources"],
          ["search_grow_content", "Matching profiles, guides, blog posts and chamber pages, with title, description and page URL"],
          ["get_chamber_guide", "The chambers hub, Shrooly install, Terrashroom, reuse and FAQ pages"],
          ["grow_timeline", "Start and end day for each stage and total days to harvest"],
        ]
      ),
    },
    {
      h2: "How do I connect it to my assistant?",
      answer: "Add https://api.shroomlabs.io/mcp as a remote MCP server using Streamable HTTP with no authentication.",
      html: `<p>The server answers plain HTTP POST requests and keeps no session, as the ${cite("mcpSpec", "MCP specification")} allows. Where your assistant calls it a custom connector or a remote server, paste the URL and leave authentication off. Test it from a terminal with a <code>tools/list</code> request.</p>`,
    },
    {
      h2: "What does an answer look like?",
      answer: `Ask "how long does pearl oyster take" and the assistant can call grow_timeline and get the profile's stage by stage days, ${days("pearl-oyster")} in total, with a link to the profile page.`,
      html: `<p>The numbers come from the same profile data as ${link("pearl-oyster", "the pearl oyster guide")}, so the assistant and this site never disagree.</p>`,
    },
    {
      h2: "What is not in the MCP server?",
      answer: "No Grow Coach chat, no chamber control, no accounts and no payments: it is a library, not a remote control.",
      html: `<p>That keeps it safe to leave open to everyone. For advice about a specific chamber, use <a href="/ai/grow-coach">Grow Coach</a>.</p>`,
    },
  ],
};

/* ----------------------------------------------------------------------------- question pages */

const canAiGrow = {
  slug: "can-ai-grow-mushrooms",
  og: "ai-can-ai-grow-mushrooms",
  title: "Can AI grow mushrooms? What it can and cannot do",
  h1: "Can AI grow mushrooms?",
  crumb: "Can AI grow mushrooms?",
  eyebrow: "Connect your grow to AI",
  updated: AI_UPDATED,
  description: "AI cannot grow mushrooms on its own, but it can watch a chamber around the clock and make small, logged changes. What it handles and what needs you.",
  answer: "Not by itself. Mushrooms grow from mycelium when temperature, humidity, fresh air and light are right, and a chamber's hardware does that work. What AI can do well is watch the readings around the clock, notice drift sooner than you would, and make small, logged adjustments inside limits a person set. That is how Shroom Labs uses it.",
  cta: [["How Shroom Labs uses AI", "/ai"], ["Easiest mushrooms to grow", "/guides/easiest-mushrooms-to-grow"]],
  sources: ["coachLearn", "autopilot", "photo"],
  related: [["How to grow mushrooms at home", "/guides/grow-mushrooms-at-home"], ["Grow kit vs monotub vs smart chamber", "/guides/grow-kit-vs-monotub-vs-smart-chamber"]],
  sections: [
    {
      h2: "What parts of growing can AI actually handle?",
      answer: "Watching readings, timing stage changes, nudging targets, and giving a first read on a photo.",
      html: table(
        "Where AI helps in a home grow",
        ["Task", "Can AI help?", "How it works on Shroom Labs"],
        [
          ["Watching temperature and humidity", "Yes", `Reads every check in, about every ${FACTS.heartbeatMin} minutes`],
          ["Knowing when to switch stages", "Yes", "Counts grow days through the profile's stage lengths"],
          ["Small target changes", "Yes, inside limits", `One fixed step at a time, at most ${FACTS.dailyCap} a day`],
          ["Noticing a chamber that cannot keep up", "Yes", "Tracks humidity lag and temperature offset per chamber"],
          ["Looking at the block", "A first read", "Photo check names stage and issues with a confidence score"],
          ["Mixing substrate, clean work, refilling water, harvesting", "No", "Hands only"],
        ]
      ),
    },
    {
      h2: "What still needs a person?",
      answer: "Everything physical, and the final call on contamination and harvest.",
      html: `<p>You prepare or buy the block, keep things clean, fill the reservoir, and pick the mushrooms. A photo check can point out what might be mold, but you decide whether to toss a block. Read <a href="/guides/mushroom-contamination">mushroom contamination</a> for what to look for.</p>`,
    },
    {
      h2: "Is AI better than a simple humidity controller?",
      answer: "It does a different job: a controller holds one number, while a coach layer changes that number by species and stage and notices when the chamber cannot reach it.",
      html: `<p>A humidity controller with a fan timer is still the base loop, and it works well. The firmware in a Shroom Labs chamber is that loop. Grow Coach adds stage timing and a record of why each target changed. If you only grow one kit at a time on a counter, a controller or plain misting may be all you need.</p>`,
    },
    {
      h2: "Can AI make a bad call and ruin a grow?",
      answer: "A model can pick a poor nudge, which is why on Shroom Labs it only answers raise, hold or lower and code decides how far anything moves.",
      html: `<p>Steps are small and fixed, changes are spaced at least an hour apart, temperature and humidity have hard ranges, and Autopilot pauses on stale or impossible readings. Every change can be undone. The full list is on the <a href="/ai/autopilot">Autopilot page</a>.</p>`,
    },
    {
      h2: "Do you need AI to grow mushrooms at home?",
      answer: "No. Oyster and lion's mane kits fruit on a kitchen counter with misting and indirect light.",
      html: `<p>Start with the <a href="/guides/easiest-mushrooms-to-grow">easiest mushrooms to grow</a> and <a href="/guides/how-long-to-grow-mushrooms">how long mushrooms take</a>. AI is worth it when you run a chamber for weeks and want it to adjust itself. If you have a Shrooly or a Lykyn, that starts with <a href="/install">flashing a Shrooly</a> or <a href="/lykyn">flashing a Lykyn</a>, then <a href="/coach">Grow Coach</a>.</p>`,
    },
  ],
};

const humidityFae = {
  slug: "smart-mushroom-grow-box-humidity-and-fresh-air",
  og: "ai-smart-grow-box-humidity-fresh-air",
  title: "How a smart mushroom grow box automates humidity and fresh air",
  h1: "How does a smart mushroom grow box automate humidity and fresh air?",
  crumb: "Smart grow box humidity and fresh air",
  eyebrow: "Connect your grow to AI",
  updated: AI_UPDATED,
  description: "A smart mushroom grow box runs the mister on a humidity band and the fan on a timer, both set per species and stage. Here is how the loop works.",
  answer: "A smart grow box runs a loop. A sensor reads humidity, the mister switches on when humidity drops below the target minus a small margin and off when it passes the target plus that margin, and a fan runs on a timer, a set number of seconds every so many minutes, to swap stale air for fresh. The grow profile sets those numbers for each species and stage, and a coach layer like Autopilot can shift them when the chamber drifts.",
  cta: [["Fresh air planner", "/tools/fresh-air-planner"], ["Autopilot", "/ai/autopilot"]],
  sources: ["knobs", "alerts", "repo"],
  related: [["Humidity and fresh air", "/guides/humidity-and-fresh-air"], ["AC Infinity mushroom fruiting chamber", "/guides/ac-infinity-mushroom-fruiting-chamber"], ["Martha tent setup for mushrooms", "/blog/martha-tent-setup-for-mushrooms"]],
  sections: [
    {
      h2: "How does the humidity loop work?",
      answer: "The profile sets a target and a margin, called hysteresis, and the mister runs only while humidity is below the bottom of that band.",
      html: `${table("Fruiting humidity bands and fresh air timers from the free profiles", ["Mushroom", "Target", "Mister on, then off", "Fan timer"], humidityRows())}<p>The margin stops the mister from clicking on and off every few seconds. A lower humidity target or a wider margin means drier swings between mist bursts.</p>`,
    },
    {
      h2: "How does fresh air exchange work in a small chamber?",
      answer: "A fan runs for a set number of seconds every set number of minutes at a set speed, which flushes out the carbon dioxide the mushrooms breathe out.",
      html: `<p>Too little fresh air gives long stems and small caps. Too much dries the surface. To size a fan cycle for your own box or tent, use the <a href="/tools/fresh-air-planner">fresh air planner</a>, and see <a href="/guides/leggy-mushroom-stems">leggy mushroom stems</a> for the symptoms.</p>`,
    },
    {
      h2: "Why do humidity and fresh air fight each other?",
      answer: "Every fan run pulls moist air out, so more fresh air means the mister has to work harder to hold the same humidity.",
      html: `<p>That is why Autopilot holds a fan step until humidity is within ${FAN_IN_BAND} point of target, and only reaches further, up to ${FAN_ESCALATE_BAND} points from the recipe, when humidity stays off target for an hour without improving. A person tends to over correct here; a slow, spaced rule does not.</p>`,
    },
    {
      h2: "What happens when the water runs out?",
      answer: `Shroom Labs can email a low water alert below ${FACTS.waterLow}% and an urgent empty alert below ${FACTS.waterEmpty}% for chambers that report a water level.`,
      html: `<p>The empty alert sends even during quiet hours. Firmware that also stops the mister on an empty tank, and a version for chambers with no tank sensor that infers an empty tank by watching humidity fail to rise while the mister runs, are in progress and not released yet. See ${cite("alerts", "the alert rules")}.</p>`,
    },
    {
      h2: "What about temperature?",
      answer: "It depends on the chamber: a Lykyn has no heater or cooler, so it tracks temperature and boosts the fans when it runs hot, and the room has to do the rest.",
      html: `<p>Most culinary species fruit in normal room temperatures, which is why small grow boxes skip a heater. Each profile lists its own range, for example ${link("lions-mane")} fruits at ${temp(stage("lions-mane", "fruiting").temperature_c)}.</p>`,
    },
    {
      h2: "Can I automate a monotub or grow tent the same way?",
      answer: "Yes: a humidifier on a humidity controller and an exhaust fan on a cycle timer give you the same loop, set from the same profile numbers.",
      html: `<p>The <a href="/guides/ac-infinity-mushroom-fruiting-chamber">AC Infinity build guide</a> turns profile numbers into controller settings. Our AC Infinity adapter that would set them for you exists but is untested on real hardware. A Shrooly or Lykyn already has the loop built in: <a href="/install">flash a Shrooly</a> or <a href="/lykyn">flash a Lykyn</a> and it runs from the same profiles, and <a href="/ai/autopilot">Autopilot</a> can tune it.</p>`,
    },
  ],
};

const coachVsManual = {
  slug: "ai-grow-coach-vs-manual-monitoring",
  og: "ai-coach-vs-manual",
  title: "AI mushroom grow coach vs manual monitoring: which do you need?",
  h1: "AI grow coach vs checking your grow by hand",
  crumb: "AI coach vs manual",
  eyebrow: "Connect your grow to AI",
  updated: AI_UPDATED,
  description: "Checking by hand works for a kit on the counter. An AI grow coach pays off on long chamber grows. A side by side of what each catches and misses.",
  answer: "Checking by hand works fine for a kit on the counter: look twice a day, mist, fan. An AI coach pays off when a chamber runs for weeks: it reads every check in, spots slow drift like a chamber that always lags its humidity target, and leaves a written reason for each change. It does not replace your eyes on the block; contamination and harvest timing still need a look.",
  cta: [["Grow Coach", "/ai/grow-coach"], ["Grow kit not growing?", "/guides/mushroom-grow-kit-not-growing"]],
  sources: ["coachLearn", "autopilot", "chart"],
  related: [["Mushrooms not pinning", "/guides/mushrooms-not-pinning"], ["Grow kit vs monotub vs smart chamber", "/guides/grow-kit-vs-monotub-vs-smart-chamber"]],
  sections: [
    {
      h2: "How do the two compare?",
      answer: "A coach wins on how often it looks and on keeping records; you win on everything you can see and touch.",
      html: table(
        "AI grow coach vs manual monitoring",
        ["", "Checking by hand", "Grow Coach on a linked chamber"],
        [
          ["How often", "When you remember, often twice a day", `Every check in, about every ${FACTS.heartbeatMin} minutes`],
          ["Overnight drift", "Missed until morning", "Seen on the next check in"],
          ["Stage changes", "Calendar or memory", "Counted from the profile's stage lengths"],
          ["Record of changes", "A notebook, if you keep one", "Decisions feed with reasons, and chart markers"],
          ["Mold, color, smell", "Yes", "Only from a photo you take, as a first read"],
          ["Cost", "Free", "A paid Grow Coach plan"],
        ]
      ),
    },
    {
      h2: "When is checking by hand enough?",
      answer: "For one kit at a time on a counter or in a simple tub, where misting and a look twice a day cover it.",
      html: `<p>Use the <a href="/tools/grow-timeline">grow timeline calculator</a> to know what to expect when, and the profile for your species for the numbers.</p>`,
    },
    {
      h2: "When does a coach help most?",
      answer: "On a chamber that runs unattended for weeks, slow species with long stages, and chambers that cannot quite hold their targets.",
      html: `<p>The chamber model shows patterns a daily glance misses, such as humidity that sags a few points every afternoon. Coach also flags colonization that looks stalled and tells you when the fruiting window is nearly over.</p>`,
    },
    {
      h2: "What can a coach miss?",
      answer: "Anything the sensor cannot measure: mold, pests, a dry block surface under good air readings, or a reservoir that is about to run dry on a chamber with no tank sensor.",
      html: `<p>That is why the photo check exists, and why it reports a confidence score rather than a verdict.</p>`,
    },
    {
      h2: "Can I use both?",
      answer: "Yes, and Advisor mode is built for that: Coach recommends, you look at the block, and you approve the changes that match what you see.",
      html: `<p>To get there, <a href="/install">flash your Shrooly</a> or <a href="/lykyn">flash your Lykyn</a>, <a href="/claim">link it</a>, and start <a href="/coach">Grow Coach</a>. Switch to <a href="/ai/autopilot">Autopilot</a> later if you find yourself approving everything.</p>`,
    },
  ],
};

const canAiIdentify = {
  slug: "can-ai-identify-mushrooms",
  og: "ai-can-ai-identify-mushrooms",
  title: "Can AI identify mushrooms safely? What the studies found",
  h1: "Can AI identify mushrooms safely?",
  crumb: "Can AI identify mushrooms?",
  eyebrow: "Connect your grow to AI",
  updated: AI_UPDATED,
  description: "AI mushroom identification apps are not reliable enough to decide if a wild mushroom is safe to eat. What published tests found, and safer ways to start.",
  answer: "No, not well enough to decide whether a wild mushroom is safe to eat. In a 2023 Clinical Toxicology study the best of three apps identified 49% of specimens correctly, and a 2026 test of 12 tools found even the best one wrong in nearly 15% of cases. Use an app as a first clue only, confirm with an expert, and in the US call Poison Help at 1-800-222-1222 if someone ate a mushroom you are unsure of.",
  cta: [["Easiest mushrooms to grow", "/guides/easiest-mushrooms-to-grow"], ["How Shroom Labs uses AI", "/ai"]],
  sources: ["clinTox", "npj", "publicCitizen", "poison", "photo"],
  related: [["How to grow mushrooms at home", "/guides/grow-mushrooms-at-home"], ["Grow mushrooms from store bought mushrooms", "/blog/grow-mushrooms-from-store-bought-mushrooms"]],
  sections: [
    {
      h2: "What did the studies find?",
      answer: "Every published test so far found identification apps too unreliable to rule out a poisonous mushroom on their own.",
      html: `<ul>
<li>${cite("clinTox", "Clinical Toxicology, 2023")}: three apps were tested on photos of 78 specimens sent to an Australian poisons centre and botanic garden. The most accurate identified 49% correctly, and 44% of the poisonous ones. The authors concluded the apps are not reliable enough to exclude exposure to poisonous mushrooms when used alone.</li>
<li>${cite("npj", "npj Science of Food, 2026")}: 12 tools were tested on more than 100 real world photos of nearly 60 species. The best performer still failed in nearly 15% of cases, and none consistently gave a single correct answer.</li>
<li>${cite("publicCitizen", "Public Citizen, 2024")}: a consumer group report warned that AI identification tools are being marketed to beginner foragers and that some misidentifications appear to come from regional bias.</li>
</ul>`,
    },
    {
      h2: "Why do photo apps get mushrooms wrong?",
      answer: "Many toxic and edible species look alike in a photo, and young mushrooms can look very different from mature ones.",
      html: `<p>The 2026 study found that only 3 of 12 tools named fly agaric first when shown it at the button stage, while 10 of 12 got it right when mature. A photo also cannot show spore print color, smell, or what is under the soil, which experts use.</p>`,
    },
    {
      h2: "Does Grow Coach's photo check identify mushrooms?",
      answer: "No. It assumes you already know the species because you are growing it from a culinary profile, and it refuses photos that are not a mushroom grow.",
      html: `<p>It looks at stage and problems such as drying or possible mold on a grow you set up, as part of <a href="/coach">Grow Coach</a>. See <a href="/ai/photo-check-and-charts">photo check and charts</a>.</p>`,
    },
    {
      h2: "What is a safer way to get into mushrooms?",
      answer: "Grow a known culinary species from a kit or a block, where you know exactly what you are eating.",
      html: `<p>Oyster and lion's mane are good first grows. Start with the <a href="/guides/easiest-mushrooms-to-grow">easiest mushrooms to grow</a> or <a href="/guides/grow-mushrooms-at-home">how to grow mushrooms at home</a>. If you want to forage, learn in person with a local mycological society before eating anything you picked.</p>`,
    },
    {
      h2: "What should I do if someone ate a mushroom I am not sure about?",
      answer: "In the US, call Poison Help at 1-800-222-1222 right away, even if nobody feels sick yet, and keep any leftover mushroom or a photo of it.",
      html: `<p>Poison control is free, expert and confidential. Call 911 if the person collapses, has a seizure, has trouble breathing, or cannot be woken. Source: ${cite("poison")}.</p>`,
    },
  ],
};

/** The hub first, then features, then question pages. Order is the order on the hub. */
export const AI_HUB = hub;
export const AI_FEATURES = [growCoach, autopilot, photoCharts, openFirmware, mcp];
export const AI_QUESTIONS = [canAiGrow, humidityFae, coachVsManual, canAiIdentify];
export const AI_SPOKES = [...AI_FEATURES, ...AI_QUESTIONS].map((p) => ({ ...p, path: `/ai/${p.slug}` }));
export const AI_PAGES = [{ ...hub }, ...AI_SPOKES];
export { SPOKE_LINKS };
