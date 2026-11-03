/** Build cluster: chambers you put together yourself. Settings come from the profiles through the AC Infinity adapter, so nothing is typed by hand. */
import { stagePortSettings } from "../../../api/src/adapters/ac-infinity.js";
import { SOURCES } from "../chambers/index.js";
import { link, profile, stage, temp } from "./data.js";

const UPDATED = "2026-11-03";
const a = (key, text) => `<a href="${SOURCES[key].url}" rel="noopener">${text}</a>`;
const PORTS = { humidifier: 1, fan: 2, heater: 3 };
const SPECIES = ["pearl-oyster", "blue-oyster", "pink-oyster", "lions-mane", "shiitake"].filter((id) => {
  try { return Boolean(profile(id)); } catch { return false; }
});

const table = (caption, heads, rows) =>
  `<div class="table-wrap"><table class="conditions-table"><caption>${caption}</caption><thead><tr>${heads.map((h) => `<th scope="col">${h}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;

function settingsRow(id) {
  const s = stage(id, "fruiting");
  const by = Object.fromEntries(stagePortSettings(s, PORTS).map((p) => [p.device, p.values]));
  const hum = by.humidifier ? `${by.humidifier.devLh}%, speed ${by.humidifier.onSpead}` : "Off";
  const heat = by.heater ? temp(by.heater.devLt) : "Off";
  const fan = by.fan ? `${by.fan.activeCycleOn / 60} min on, ${by.fan.activeCycleOff / 60} min off, speed ${by.fan.onSpead}` : "Off";
  return `<tr><th scope="row">${link(id)}</th><td>${hum}</td><td>${heat}</td><td>${fan}</td></tr>`;
}

const acInfinityBuild = {
  slug: "ac-infinity-mushroom-fruiting-chamber",
  title: "AC Infinity mushroom fruiting chamber: tent or martha rack build",
  h1: "Build a mushroom fruiting chamber with an AC Infinity Controller 69 PRO",
  eyebrow: "Chamber build",
  description: "Build a mushroom fruiting chamber in a grow tent or martha rack with an AC Infinity Controller 69 PRO: parts, port wiring, and settings from our grow profiles.",
  answer: "Put a grow tent or martha rack, a Controller 69 PRO, a humidifier, an exhaust fan, and a heater together. The humidifier runs on the low humidity trigger, the heater on the low temperature trigger, and the fan on a cycle for fresh air. The settings for each species come straight from its free grow profile.",
  sections: [
    {
      h2: "What parts do I need?",
      html: `<ul>
<li><strong>An enclosure.</strong> A grow tent, or a martha rack: a wire shelf unit with a zip up plastic cover. Either holds humidity and gives you shelves or floor space for blocks.</li>
<li><strong>The controller.</strong> An AC Infinity Controller 69 PRO. It has 4 UIS ports, 10 speed levels on each, and a sensor probe for temperature and humidity, and it connects to the app over Bluetooth or 2.4 GHz Wi-Fi (${a("aciManual", "Controller 69 PRO manual")}).</li>
<li><strong>A humidifier.</strong> A CLOUDFORGE humidifier plugs straight into a port. AC Infinity lists the CLOUDFORGE line as compatible with the 69 PRO (${a("aciEcosystem", "ecosystem chart")}). A regular humidifier works through the UIS Control Plug if it turns itself back on when it gets power.</li>
<li><strong>An exhaust fan.</strong> A CLOUDLINE inline fan or a CLOUDRAY clip fan, both on the same chart.</li>
<li><strong>A heater, if your room runs cool.</strong> A THERMOFORGE heater, also on the chart. Do not run a space heater through the UIS Control Plug: AC Infinity warns against continuous high wattage loads on it (${a("aciPlug", "UIS Control Plug")}).</li>
</ul>
<p>Each port runs one program, so give every device its own port.</p>`,
    },
    {
      h2: "How do I wire the ports?",
      html: `<p>One device per port keeps it simple. This is the layout our adapter and the table below assume:</p>
<ol>
<li><strong>Port 1, humidifier.</strong> AUTO mode, low humidity trigger on, everything else off.</li>
<li><strong>Port 2, exhaust fan.</strong> CYCLE mode, on for the fresh air run, off for the rest of the period.</li>
<li><strong>Port 3, heater.</strong> AUTO mode, low temperature trigger on, everything else off.</li>
<li><strong>Port 4, spare.</strong> A circulation fan or a light, if you want one.</li>
</ol>
<p>The manual describes the low humidity trigger as the one for humidifiers and the low temperature trigger as the one for heating. A port in AUTO turns on when the reading reaches its trigger and off once it moves past it.</p>
<p>Hang the sensor probe at the height of your blocks, out of the direct mist. A probe in the mist reads wet and keeps the humidifier off while the rest of the chamber dries out.</p>`,
    },
    {
      h2: "What settings should I use for each mushroom?",
      html: `<p>These are the fruiting stage numbers from each free grow profile, turned into controller settings the same way our adapter does it. Fan times are rounded up to whole minutes, the way the community integration our adapter is built from sets cycle times.</p>
${table("Controller 69 PRO fruiting settings from the grow profiles", ["Mushroom", "Humidifier low trigger", "Heater low trigger", "Fan cycle"], SPECIES.map(settingsRow))}
<p>The heater trigger is the profile temperature minus its hysteresis, so the heater only runs when the room is below the range the profile allows. Other stages, such as pinning, have their own numbers on each profile page in the <a href="/grow">grow profiles</a>.</p>`,
    },
    {
      h2: "Can Shroom Labs set the controller for me?",
      html: `<p>Yes, with a free community adapter that is untested on real hardware. It signs in to your AC Infinity account through the same cloud the app uses, reads each port, and writes the new values. It works with Wi-Fi models such as the 69 PRO, not the Bluetooth only Controller 69. Read <a href="/ac-infinity">AC Infinity for mushrooms</a> first: it covers how the adapter works, what is untested, and why your password stays on your computer.</p>`,
    },
    {
      h2: "How much fresh air does a tent need?",
      html: `<p>More than most people expect. Mushrooms breathe out carbon dioxide, and too much of it gives long stems and small caps. The fan cycle in each profile is a starting point. Size the run time to your tent with the <a href="/tools/fresh-air-planner">fresh air planner</a>, and lengthen it if stems stretch. <a href="/guides/humidity-and-fresh-air">How much humidity and fresh air mushrooms need</a> goes deeper.</p>
<p>Fresh air dries the chamber, so you will see the humidifier kick on after every fan run. That is normal. If humidity never recovers between runs, move the humidifier output closer to the blocks or shorten the fan run a little.</p>`,
    },
    {
      h2: "What goes wrong most often?",
      html: `<ul>
<li><strong>Water on everything.</strong> Fog that settles on the floor and walls drips. Point the humidifier output into open air and put a tray under the blocks.</li>
<li><strong>The humidifier never stops.</strong> Check the probe is not in the mist and the tent zips are closed.</li>
<li><strong>The heater runs all the time.</strong> The room is too cold for the tent to hold heat. Move the tent or insulate the floor.</li>
<li><strong>Pins stall.</strong> Usually too little fresh air or too little humidity. Go through <a href="/guides/mushrooms-not-pinning">mushrooms not pinning</a>.</li>
</ul>`,
    },
  ],
  faq: [
    { q: "Can an AC Infinity controller run a mushroom fruiting chamber?", a: "Yes. A Controller 69 PRO can run a humidifier on its low humidity trigger, a heater on its low temperature trigger, and an exhaust fan on a cycle, all from one probe." },
    { q: "Which AC Infinity humidifier works with the Controller 69 PRO?", a: "AC Infinity lists its CLOUDFORGE humidifiers as compatible. A regular humidifier also works through the UIS Control Plug if it turns itself back on when it gets power." },
    { q: "Can I use a space heater with the UIS Control Plug?", a: "AC Infinity warns against continuous high wattage loads such as heaters on the UIS Control Plug, so use a THERMOFORGE heater on a UIS port instead." },
    { q: "Does Shroom Labs control AC Infinity controllers?", a: "There is a free community adapter for Wi-Fi models such as the 69 PRO. It is untested on real hardware, and it is a dry run unless you tell it to write." },
  ],
  related: [
    ["AC Infinity for mushrooms", "/ac-infinity"],
    ["Fresh air planner", "/tools/fresh-air-planner"],
    ["How much humidity and fresh air mushrooms need", "/guides/humidity-and-fresh-air"],
    ["Conditions for every species", "/grow"],
  ],
  updated: UPDATED,
};

export const BUILD_GUIDES = [acInfinityBuild];
