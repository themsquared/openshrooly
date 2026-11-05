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

const lykynOutsideControl = {
  slug: "lykyn-mushroom-grow-box-outside-control",
  title: "Lykyn mushroom grow box: outside control without flashing",
  h1: "Outside control for a Lykyn mushroom grow box",
  eyebrow: "Chamber guide",
  description: "What outside control means for a Lykyn, what we will record when the box arrives, and how that differs from flashing a Shrooly chamber.",
  answer: "Outside control means we talk to a Lykyn through its existing app and cloud, and we leave the stock software on the box. When our unit arrives we will record what the official app sends, write it up in a public adapter repo, and only then try a dry run. None of that is proven yet. This is not a reflash, which is how OpenShrooly runs a Shrooly chamber.",
  sections: [
    {
      h2: "What does outside control mean?",
      html: `<p>Outside control is a way to read and set a chamber without replacing the software that shipped on it. The official app stays the source of how the box talks. We watch that path, write down the reads and writes, and later wrap them in a small adapter so a grow profile can drive the same settings.</p>
<p>For a Lykyn that means:</p>
<ul>
<li><strong>Stock software stays on the box.</strong> We do not flash it. We do not ask you to open it.</li>
<li><strong>The official app and cloud stay in place.</strong> The adapter, once it exists, would sign in the same way the app does, on your own computer.</li>
<li><strong>Credentials stay with you.</strong> Email and password would live as environment variables on the machine that runs the adapter, the same way the <a href="/ac-infinity">AC Infinity adapter</a> does. Shroom Labs would not store them.</li>
<li><strong>A dry run comes first.</strong> A first tool should print the plan and write nothing, until someone adds an apply flag on purpose.</li>
</ul>
<p>That is the plan. It is not a working adapter. Read <a href="/lykyn">Lykyn for mushrooms</a> for the arrival status.</p>`,
    },
    {
      h2: "What will we look at when the box arrives?",
      html: `<p>The unit is in transit. Until it is on a bench here, there is nothing to record. When it arrives we will set it up the way Lykyn describes on the ${a("lykynSite", "official Lykyn site")}: water in the reservoir, a fruiting block on the tray, species picked in the app. Then we watch three links.</p>
<ol>
<li><strong>Phone to box.</strong> What the official app sends over the local network, if it talks to the box directly at all.</li>
<li><strong>Phone to cloud.</strong> What the app sends to Lykyn's servers to read humidity and temperature, and to change humidity, fans, light, or the species preset.</li>
<li><strong>Box to cloud.</strong> Whether the chamber reports readings on its own, and how often.</li>
</ol>
<p>We will write down field names, units, and which settings the app actually changes. Those notes go in the ${a("lykynAdapter", "Shroom Labs Lykyn adapter on GitHub")}. The repo is public on purpose. Credentials stay out of it.</p>
<p>We are looking for the same kinds of things a grow profile needs: humidity, temperature, fresh air, and light. If those can be read and set from outside, a later adapter can map a free profile onto them. If they cannot, this guide will say so and you should keep using the Lykyn app by hand with the numbers from the <a href="/grow">grow profiles</a>.</p>
<p>Nothing in that list is mapped yet. Treat every endpoint, field, and unit as unknown until a note lands in the repo with a date.</p>`,
    },
    {
      h2: "What is untested?",
      html: `<p>All of it. Outside-control validation has not started. The public repo holds a short pitch, not a tool you can run.</p>
<ul>
<li>Whether a sign in from software we write is accepted.</li>
<li>Whether live humidity and temperature can be read from outside.</li>
<li>Whether humidity, fans, light, or a species preset can be set from outside.</li>
<li>Whether those writes match what the official app shows after they land.</li>
<li>Whether a Lykyn holds fruiting humidity for lion's mane, oyster, or shiitake the way the profiles ask.</li>
<li>How a Lykyn compares to a Shrooly chamber on the same block. That comparison is the planned <a href="/grow-log">grow log</a>, and it has not started.</li>
</ul>
<p>Until those are checked, do not claim a Lykyn is supported. The <a href="/chambers">chambers table</a> marks it Arriving. The grow log marks it arriving, outside-control validation pending. Both stay that way until someone here has read and set a real unit from outside.</p>`,
    },
    {
      h2: "How is this different from flashing a Shrooly chamber?",
      html: `<p>OpenShrooly replaces the stock software on a Shrooly chamber. You install it from Chrome or Edge with a USB-C cable in about 5 minutes. After that the chamber runs on your own Wi-Fi from a local web page, and the Shrooly app is not in the path. That is a reflash.</p>
<p>The Lykyn plan is the opposite. The stock software stays. The official app stays. We build a translator that sits outside and speaks the same language the app already speaks. If Lykyn changes that language, the adapter can break. If it breaks, you still have the official app and can set the box by hand from a grow profile.</p>
<p>Terrashroom is on the flash path, like a Shrooly chamber: community ESPHome firmware, untested on real hardware. AC Infinity is on the outside-control path, like Lykyn: a cloud adapter written from a community integration, also untested on a real controller. Lykyn is earlier than AC Infinity. AC Infinity has adapter code and tests against a fake server. Lykyn has a repo and a plan.</p>
<div class="table-wrap"><table class="conditions-table"><caption>How Shroom Labs talks to each chamber, November 5, 2026</caption><thead><tr><th scope="col">Chamber</th><th scope="col">Method</th><th scope="col">Status</th></tr></thead><tbody>
<tr><th scope="row"><a href="/install">Shrooly chamber</a></th><td>Flash OpenShrooly. Local web page, no stock app.</td><td>Supported</td></tr>
<tr><th scope="row"><a href="/terrashroom">Terrashroom</a></th><td>Flash community ESPHome firmware.</td><td>Community, untested</td></tr>
<tr><th scope="row"><a href="/ac-infinity">AC Infinity</a></th><td>Cloud adapter. Stock controller software stays.</td><td>Community, untested</td></tr>
<tr><th scope="row"><a href="/lykyn">Lykyn</a></th><td>Outside-control adapter planned. Stock software stays.</td><td>Arriving, validation pending</td></tr>
</tbody></table></div>
<p>If you want the chamber to run with no vendor app at all, a Shrooly chamber with OpenShrooly is the one we already run. A Lykyn will keep using Lykyn's app until someone proves an outside path, and maybe after that too.</p>`,
    },
    {
      h2: "Can I use a grow profile on a Lykyn today?",
      html: `<p>Yes, by hand. Open the species in the <a href="/grow">grow profiles</a>, copy the humidity, temperature, fresh air, and light for the stage you are in, and set the official Lykyn app as close as it allows. The app's species presets are Lykyn's, not ours. We have not compared them to the profiles.</p>
<p>Automatic apply from Shroom Labs is the adapter's job, and that job has not started. The <a href="/tools/grow-timeline">grow timeline calculator</a> still helps you pick stage dates while the box runs on its own controls.</p>
<p>Shroom Labs is not made by Lykyn. Product steps quoted above come from the official site. If you own a box and want to share what the app lets you set, use the contact page on this site and pick A chamber.</p>`,
    },
  ],
  faq: [
    { q: "What does outside control mean?", a: "We talk to the Lykyn through its existing app and cloud, and we leave the stock software on the box." },
    { q: "Will Shroom Labs flash the Lykyn?", a: "No. The plan is outside control. Flashing is how OpenShrooly runs a Shrooly chamber, not how we plan to run a Lykyn." },
    { q: "Can I use a grow profile on a Lykyn today?", a: "Yes, by copying the numbers into the official Lykyn app. Shroom Labs cannot apply a profile to a Lykyn yet." },
    { q: "Where is the adapter code?", a: "In the public lykyn-adapter repo on GitHub. It is a pitch and a place for notes. Nothing in it talks to a real Lykyn yet." },
  ],
  related: [
    ["Lykyn for mushrooms", "/lykyn"],
    ["Shroom Labs grow log", "/grow-log"],
    ["Mushroom chambers that work with Shroom Labs", "/chambers"],
    ["Conditions for every species", "/grow"],
  ],
  updated: "2026-11-05",
};

export const BUILD_GUIDES = [acInfinityBuild, lykynOutsideControl];
