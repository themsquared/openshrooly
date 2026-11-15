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
  title: "Lykyn mushroom grow box: Shroom Labs firmware",
  h1: "How to run a Lykyn with Shroom Labs firmware",
  eyebrow: "Chamber guide",
  description: "Install native Shroom Labs firmware on a Lykyn Smart Mushroom Grow Box. Validated on a real unit. Backup first, then flash, link, and grow.",
  answer: "Shroom Labs runs a Lykyn with native firmware on the ESP32-C3, validated on a real unit. Back up the stock 4 MB flash first, flash the public image, and do not erase the flash. After that the box has a local dashboard, an optional cloud link, grow profiles, and Coach. This used to describe an outside-control plan that left the stock app in place. That is no longer the supported path.",
  sections: [
    {
      h2: "Does Shroom Labs work with a Lykyn now?",
      html: `<p>Yes. Native firmware from the ${a("lykynFirmware", "Shroom Labs Lykyn firmware repo")} runs on a real unit. The <a href="/chambers">chambers table</a> marks Lykyn as supported, the same status as a Shrooly chamber.</p>
<p>Once it is installed you can:</p>
<ul>
<li>Open the local dashboard at the chamber's address. The stock ESPHome entity table is at /esp.</li>
<li>Link the box to a Shroom Labs account with the claim code it shows, or leave cloud off and stay on the LAN.</li>
<li>Start a culinary grow profile. Colonization on a Lykyn uses the phase name Colonization. A Shrooly chamber uses Colonizing for the same stage.</li>
<li>Use <a href="/coach">Grow Coach</a> in Advisor or Autopilot mode. Turn Coach off before you set targets yourself.</li>
</ul>
<p>Read <a href="/lykyn">Lykyn for mushrooms</a> for the hardware, ranges, and stage names.</p>`,
    },
    {
      h2: "How do I flash a Lykyn safely?",
      html: `<p>Back up the full stock flash first. The stock image and Shroom Labs firmware share a 4 MB partition layout, so that backup can be written back. Do not run erase_flash: that can wipe factory data the backup is meant to keep.</p>
<ol>
<li>Read the <a href="https://github.com/themsquared/lykyn-firmware/blob/main/docs/FLASH.md">flash guide</a> in the firmware repo. Use a USB data cable. The ESP32-C3 has native USB-Serial/JTAG, and download mode is how you put the chip in flash mode.</li>
<li>Save a complete 4 MB backup of the unit as it shipped, and keep that file somewhere you can find.</li>
<li>Build or download the image from the public repo. The provisioning build has no Wi-Fi baked in. After it boots, the box opens a Lykyn-Setup network, and Improv over USB also works.</li>
<li>Flash only the slots the guide names. If something goes wrong, write the backup back. USB is the way home.</li>
</ol>
<p>This is not the <a href="/install">USB installer for a Shrooly chamber</a>. That page is for Shrooly chambers only.</p>`,
    },
    {
      h2: "What can the firmware actually do?",
      html: `<p>It reads the SHT3x for temperature and humidity, runs a local climate loop with no cloud required, and drives both PWM fans, the ultrasonic mister, and the 16 pixel grow ring.</p>
<ul>
<li>Humidity targets: 30 to 95 percent relative humidity, in 0.5 steps.</li>
<li>Fans: 33 to 100 percent duty. The firmware will not run them below 33 percent. A profile that asks for 20 percent is clamped to 33, and the apply still succeeds.</li>
<li>Stages: Fruiting, Pinning, Colonization, and Custom. Colonization lights stay off.</li>
<li>There is no heater or cooler. Over-temperature or over-humidity boosts the fans. If the sensor is lost for 60 seconds, the mister turns off and the fans sit at 33 percent.</li>
</ul>
<p>Cloud is optional. A cloud failure does not change the local loop.</p>`,
    },
    {
      h2: "How is this different from a Shrooly chamber?",
      html: `<p>Both now run Shroom Labs firmware and can link to the same site, profiles, and Coach. The differences are the hardware and a few names and ranges.</p>
<div class="table-wrap"><table class="conditions-table"><caption>How Shroom Labs talks to each chamber, November 15, 2026</caption><thead><tr><th scope="col">Chamber</th><th scope="col">Method</th><th scope="col">Status</th></tr></thead><tbody>
<tr><th scope="row"><a href="/install">Shrooly chamber</a></th><td>Flash OpenShrooly from the USB installer. Local dashboard and cloud link.</td><td>Supported</td></tr>
<tr><th scope="row"><a href="/lykyn">Lykyn</a></th><td>Flash native Shroom Labs firmware from the public repo. Local dashboard and cloud link.</td><td>Supported</td></tr>
<tr><th scope="row"><a href="/terrashroom">Terrashroom</a></th><td>Flash community ESPHome firmware.</td><td>Community, untested on real hardware</td></tr>
<tr><th scope="row"><a href="/ac-infinity">AC Infinity</a></th><td>Cloud adapter. Stock controller software stays.</td><td>Community, untested</td></tr>
</tbody></table></div>
<p>White light is lux on a Shrooly chamber (0 to 4000) and percent on a Lykyn (0 to 100). The cloud converts a profile's lux figure when it talks to a Lykyn.</p>`,
    },
    {
      h2: "What happened to the outside-control plan?",
      html: `<p>Before the unit arrived, this guide described talking to the official Lykyn app and cloud without flashing, and leaving the stock software on the box. That work was never the validated path. The ${a("lykynAdapter", "Shroom Labs Lykyn adapter on GitHub")} is still public as notes, and credentials stay out of it.</p>
<p>If you do not want to flash, you can keep the official Lykyn app and copy numbers from a <a href="/grow">grow profile</a> by hand. Automatic apply, the local Shroom Labs dashboard, and Coach need the native firmware.</p>`,
    },
  ],
  faq: [
    { q: "Does Shroom Labs work with a Lykyn now?", a: "Yes. Native firmware runs on a real unit, with a local dashboard, an optional cloud link, grow profiles, and Coach." },
    { q: "How do I flash a Lykyn safely?", a: "Back up the full stock flash first, then flash the public image. Do not erase the flash." },
    { q: "Will I lose the stock firmware?", a: "Not if you keep a full 4 MB backup. The partition layout matches stock, so you can write that backup back." },
    { q: "Can I use Grow Coach on a Lykyn?", a: "Yes. Advisor suggests targets, and Autopilot can queue them. Turn Coach off before you set targets yourself." },
    { q: "What happened to outside control?", a: "That was the plan before the unit arrived. The supported path is now native firmware. The older adapter repo remains public as notes." },
  ],
  howto: {
    name: "How to flash a Lykyn safely",
    description: "Back up the full stock flash first, then flash the public image. Do not erase the flash.",
    steps: [
      "Read the flash guide in the firmware repo. Use a USB data cable. The ESP32-C3 has native USB-Serial/JTAG, and download mode is how you put the chip in flash mode.",
      "Save a complete 4 MB backup of the unit as it shipped, and keep that file somewhere you can find.",
      "Build or download the image from the public repo. The provisioning build has no Wi-Fi baked in. After it boots, the box opens a Lykyn-Setup network, and Improv over USB also works.",
      "Flash only the slots the guide names. If something goes wrong, write the backup back. USB is the way home.",
    ],
  },
  related: [
    ["Lykyn for mushrooms", "/lykyn"],
    ["Shroom Labs grow log", "/grow-log"],
    ["Mushroom chambers that work with Shroom Labs", "/chambers"],
    ["Grow Coach", "/coach"],
    ["Conditions for every species", "/grow"],
  ],
  updated: "2026-11-15",
};

export const BUILD_GUIDES = [acInfinityBuild, lykynOutsideControl];
