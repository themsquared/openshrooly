/**
 * Chamber pages: the /chambers compatibility hub plus owner pages for Terrashroom,
 * AC Infinity, and Lykyn.
 *
 * Rules for this file (checked by api/test/chambers.test.js):
 * - Every status is honest. Shrooly is supported. Terrashroom and AC Infinity are
 *   community software, untested on real hardware. Lykyn is on the bench with outside
 *   control in progress. Controllers we do not run keep their own software.
 * - Every fact about another company links a public source in `sources`.
 *   No unit counts, no guesses about money or motives.
 * - Each question h2 is answered by its first sentence. Those become FAQPage markup.
 * - Plain words: no dashes, no arrows.
 */

export const CHAMBERS_UPDATED = "2026-11-13";
export const CHECKED = "November 13, 2026";

const REPO = "https://github.com/themsquared/openshrooly/tree/cursor/community-platform-fa9c/esphome/terrashroom";
const ADAPTER = "https://github.com/themsquared/openshrooly/blob/cursor/community-platform-fa9c/community/api/src/adapters/ac-infinity.js";
const LYKYN_ADAPTER = "https://github.com/themsquared/lykyn-adapter";
const a = (href, text) => `<a href="${href}" rel="noopener">${text}</a>`;

export const SOURCES = {
  terrashroomUpdate: {
    label: "Terrashroom last company update, June 24, 2025 (Internet Archive copy)",
    url: "https://web.archive.org/web/20250813201948/https://terrashroom.io/blogs/company-updates/terrashroom-last-company-update-june-24th-2025",
  },
  parkerRepo: { label: "aparkerryan27/terrashroomPublic on GitHub: pin map and ESPHome notes (November 2025)", url: "https://github.com/aparkerryan27/terrashroomPublic" },
  parkerPinout: { label: "terrashroomPublic hardware/pinout.md", url: "https://github.com/aparkerryan27/terrashroomPublic/blob/master/hardware/pinout.md" },
  redditGuide: { label: "Reddit: an owner's guide to flashing ESPHome on a Terrashroom", url: "https://www.reddit.com/r/terrashroomscam/comments/1pbkpxi/" },
  ownersThread: { label: "r/TerrashroomOwners: is flashing your own firmware feasible?", url: "https://www.reddit.com/r/TerrashroomOwners/comments/1o2le4a/" },
  espBoot: { label: "Espressif: ESP32 boot mode selection and strapping pins", url: "https://docs.espressif.com/projects/esptool/en/latest/esp32/advanced-topics/boot-mode-selection.html" },
  espFlashVoltage: { label: "Espressif: espefuse set_flash_voltage", url: "https://docs.espressif.com/projects/esptool/en/latest/esp32/espefuse/set-flash-voltage-cmd.html" },
  firmware: { label: "Shroom Labs Terrashroom firmware on GitHub", url: REPO },
  openshrooly: { label: "OpenShrooly.com, project page by Graham Stewart", url: "https://openshrooly.com/" },
  tuyaLocal: { label: "tuya-local for Home Assistant: supported devices list", url: "https://github.com/make-all/tuya-local/blob/main/DEVICES.md" },
  ihc200: { label: "tuya-local issue: Inkbird IHC-200 humidity controller detected as another device (December 2023)", url: "https://github.com/make-all/tuya-local/issues/1466" },
  aciBle: { label: "ha-ac-infinity-ble: local Bluetooth control of AC Infinity Controller 67 and 69 for Home Assistant", url: "https://github.com/Viss/ha-ac-infinity-ble" },
  aciCloud: { label: "homeassistant-acinfinity: AC Infinity Wi-Fi controllers in Home Assistant", url: "https://github.com/dalinicus/homeassistant-acinfinity" },
  aciManual: { label: "AC Infinity Controller 69 PRO manual (PDF)", url: "https://acinfinity.com/content/CTR69P2212X1_221215_CONTROLLER%2069%20PRO%20Manual.pdf" },
  aciOverview: { label: "AC Infinity: Controller 69 PRO overview", url: "https://acinfinity.com/pages/controller-programming/controller-69-pro-overview.html" },
  aciEcosystem: { label: "AC Infinity: ecosystem compatibility chart", url: "https://acinfinity.com/pages/ac-infinity-ecosystem/ecosystem-compatibility.html" },
  aciPlug: { label: "AC Infinity: UIS Control Plug for outlet powered equipment", url: "https://acinfinity.com/uis-control-plug-for-outlet-powered-equipment/" },
  aciOutlet: { label: "AC Infinity: controlling outlet devices", url: "https://acinfinity.com/pages/ac-infinity-ecosystem/controlling-outlet-devices.html" },
  nyxBle: { label: "acinfinity-ble: clean room Bluetooth library developed on a Controller 69 Pro", url: "https://github.com/Nyx000/acinfinity-ble" },
  aciAdapter: { label: "Shroom Labs AC Infinity adapter on GitHub", url: ADAPTER },
  lykynSite: { label: "Lykyn Smart Mushroom Grow Box (official site)", url: "https://lykyn.com/" },
  lykynAdapter: { label: "Shroom Labs Lykyn adapter on GitHub", url: LYKYN_ADAPTER },
};

const cite = (key) => a(SOURCES[key].url, SOURCES[key].label.split(":")[0].split(" (")[0]);

/** The hub table. `status` is the short label, shown as is. Order is how well we support it. */
export const CHAMBERS = [
  {
    name: "Shrooly",
    status: "Supported",
    how: `Free OpenShrooly firmware, installed from Chrome or Edge in about 5 minutes. Grow profiles and the phone dashboard work. <a href="/install">Install</a>.`,
  },
  {
    name: "Terrashroom",
    status: "Community, untested",
    how: `Free community ESPHome firmware. It builds and passes our checks but has not run on a real unit yet. <a href="/terrashroom">Read first</a>.`,
  },
  {
    name: "Inkbird and other Tuya Wi-Fi controllers",
    status: "Use as is",
    how: "Keep the stock app. Set it to the numbers in a grow profile, or automate it in Home Assistant with tuya-local. Shroom Labs does not control it directly.",
  },
  {
    name: "AC Infinity controllers",
    status: "Community, untested",
    how: `A free Shroom Labs adapter sets a Wi-Fi Controller 69 PRO from a grow profile through AC Infinity's cloud. It is written from a community integration and has not run on a real controller yet. <a href="/ac-infinity">Read first</a>.`,
  },
  {
    name: "Lykyn",
    status: "On bench, outside control in progress",
    how: `Stock firmware stays on the box. A Socket.IO stand-in in the public <a href="https://github.com/themsquared/lykyn-adapter">lykyn-adapter</a> speaks the same protocol as Lykyn's cloud. Live LAN control still needs a TLS cert the stock box trusts for lykyn.app, or a logged-in cloud session. <a href="/lykyn">Read first</a>.`,
  },
  {
    name: "A tub, tent, or box you built",
    status: "Use as is",
    how: `Use the free <a href="/grow">grow profiles</a> and <a href="/tools/grow-timeline">grow timeline</a> to run it by hand.`,
  },
];

const tableHtml = () =>
  `<div class="table-wrap"><table class="conditions-table"><caption>Chambers and controllers, checked ${CHECKED}</caption><thead><tr><th scope="col">Chamber</th><th scope="col">Status</th><th scope="col">How it works with Shroom Labs</th></tr></thead><tbody>${CHAMBERS.map(
    (c) => `<tr><th scope="row">${c.name}</th><td><strong>${c.status}</strong></td><td>${c.how}</td></tr>`
  ).join("")}</tbody></table></div>`;

/** Pin map from the community reverse engineering. Shown on /terrashroom and in the firmware README. */
export const TERRASHROOM_PINS = [
  ["Temperature and humidity sensor (HDC1080, I2C)", "21 and 22"],
  ["Exhaust fan", "32"],
  ["Intake fan", "33"],
  ["Blower that carries the mist", "25"],
  ["Mister (atomizer)", "13"],
  ["Heater", "12"],
  ["UV LED", "18"],
  ["Water level sense", "23, read while 15 is on"],
  ["Base light strip (24 LEDs)", "5"],
  ["Canopy light strip (64 LEDs)", "14"],
  ["Camera power", "26"],
];

const pinTable = () =>
  `<div class="table-wrap"><table class="conditions-table"><caption>Terrashroom ESP32 pins, from ${a(SOURCES.parkerPinout.url, "the community pin map")}</caption><thead><tr><th scope="col">Part</th><th scope="col">GPIO</th></tr></thead><tbody>${TERRASHROOM_PINS.map(
    ([part, pin]) => `<tr><th scope="row">${part}</th><td>${pin}</td></tr>`
  ).join("")}</tbody></table></div>`;

const terrashroom = {
  slug: "terrashroom",
  title: "Terrashroom shut down? Free firmware to keep it growing",
  h1: "Terrashroom after the shutdown",
  eyebrow: "For Terrashroom owners",
  crumb: "Terrashroom",
  updated: CHAMBERS_UPDATED,
  description: "Terrashroom closed in June 2025. Free community ESPHome firmware runs it on your own Wi-Fi with no cloud. Untested on real hardware, and we need testers.",
  answer:
    "Terrashroom closed in June 2025 and said its devices would stop working as its cloud service ended. Shroom Labs now has free community firmware that runs a Terrashroom on your own Wi-Fi with no cloud. It is untested on real hardware, so we are looking for owners to try it first.",
  cta: [
    ["Help test it", "/contact?topic=chamber"],
    ["See the firmware", REPO],
  ],
  sections: [
    {
      h2: "What happened to Terrashroom?",
      answer: "On June 24, 2025 the company posted that it was closing after 3.5 years and that devices would be sunsetted over 30 days because it could no longer run its IoT service.",
      html: `<p>That is from the ${cite("terrashroomUpdate")}. The same post said the company was being dissolved, that it could not issue refunds, and that customers could file a claim through a form it linked. terrashroom.io no longer loads, so we read the post in the Internet Archive copy.</p>`,
    },
    {
      h2: "Can I still use my Terrashroom?",
      answer: "Yes, if you are willing to open it and flash new firmware, because the hardware does not need the old cloud.",
      html: `<p>Inside is an ESP32 board that drives a heater, two fans, a blower, a mister, light strips, and a UV LED, and reads a temperature and humidity sensor. Owners on Reddit asked whether flashing was possible (${cite("ownersThread")}), and one wrote ${cite("redditGuide")}. Parker Ryan published the pin map in ${cite("parkerRepo")}. Our firmware is written from that pin map.</p>
      ${pinTable()}`,
    },
    {
      h2: "What does the Shroom Labs Terrashroom firmware do?",
      answer: "It runs everything except the camera from a local web page: temperature and humidity readings, misting, fresh air, the heater, the lights, and a water check.",
      html: `<ul>
        <li><strong>Humidity.</strong> Auto Climate mists when humidity drops 2 points under your target, at most once a minute, and runs both fans if it goes over 96%.</li>
        <li><strong>Fresh air.</strong> Fans run on a schedule you set, for example 60 seconds every 30 minutes.</li>
        <li><strong>Heat.</strong> Heater Control heats toward your target with a power cap, a 10 minute run limit, and a cutoff at 32 °C (90 °F). It is off every time the chamber starts.</li>
        <li><strong>Light.</strong> The canopy strip follows a daily schedule.</li>
        <li><strong>Local control.</strong> A password protected web page, test buttons for the fans, mister, and heater, and Home Assistant support. No account or cloud.</li>
      </ul>
      <p>Auto Climate and Heater Control both start off, so nothing runs until you turn it on.</p>`,
    },
    {
      h2: "What is untested?",
      answer: "All of it, on a real unit. The firmware builds and passes our automated checks, but nobody at Shroom Labs has run it on a Terrashroom yet.",
      html: `<ul>
        <li>Every part on real hardware.</li>
        <li>Which way the water sensor reads. We assume it reads high when there is water.</li>
        <li>How hot the heater gets at a given power.</li>
        <li>The LED counts and colors on both light strips.</li>
        <li>The camera. It is not supported yet.</li>
        <li>Phone pairing. It is not set up for Terrashroom yet.</li>
      </ul>`,
    },
    {
      h2: "Why does the heater matter when you flash it?",
      answer: "The heater is wired to GPIO12, a pin the ESP32 checks when it powers on, and if that pin is high then, the board will not boot or flash.",
      html: `<p>When GPIO12 is high at reset, the ESP32 sets its flash memory to 1.8 V, which the 3.3 V flash chip cannot run on (${cite("espBoot")}). The serial log then shows <code>flash read err, 1000</code>. The Reddit guide's author reported that his board later stopped booting after running the heater hard, and suspected this pin.</p>
      <p>Our firmware turns the heater off at the earliest step of every start and again before every restart, and never pulls the pin up. If a board still will not boot, there is a last resort: an eFuse that makes the chip ignore GPIO12 and always use 3.3 V (${cite("espFlashVoltage")}). It cannot be undone, so only use it after you confirm the module has 3.3 V flash.</p>`,
    },
    {
      h2: "How do I flash a Terrashroom?",
      answer: "Open the unit, connect a 3.3 V USB serial adapter to the flash header, save a backup of the stock firmware, then flash with ESPHome.",
      html: `<ol>
        <li>Unplug the chamber from the wall before you open it.</li>
        <li>Find the flash header: EN, GPIO0, GND, TX, and RX.</li>
        <li>Connect a 3.3 V USB serial adapter. Do not connect 5 V. Power the chamber from its own supply.</li>
        <li>Hold GPIO0 to ground while you reset to enter flash mode.</li>
        <li>Save the stock firmware with esptool before you change anything.</li>
        <li>Build the firmware with ESPHome and flash it, or flash the build at web.esphome.io.</li>
        <li>Join the Terrashroom Setup Wi-Fi network and pick your home Wi-Fi.</li>
      </ol>
      <p>The full steps, commands, and pin notes are in the ${cite("firmware")} folder.</p>`,
    },
    {
      h2: "Can I go back to the stock Terrashroom firmware?",
      answer: "Only if you saved a backup first, and the stock firmware still depends on a cloud service that has ended.",
      html: `<p>A backup is one esptool command and takes a few minutes. Keep it somewhere safe. With it you can flash the original back at any time.</p>`,
    },
    {
      h2: "Does a Terrashroom work with Shroom Labs grow profiles?",
      answer: "Yes, you can use the free grow profiles today by setting the targets on the chamber's web page, but phone pairing is not set up for Terrashroom yet.",
      html: `<p>Pick your species in <a href="/grow">the grow profiles</a> and copy its humidity, temperature, fresh air, and light numbers into the chamber. Automatic profiles and the phone dashboard come after the firmware is proven on real units.</p>`,
    },
    {
      h2: "Can I help test it?",
      answer: "Yes. If you own a Terrashroom and are comfortable opening it, message us and we will go through a first flash with you.",
      html: `<p><a href="/contact?topic=chamber">Message us</a> and pick A chamber. Tell us what your unit does now and whether you have a USB serial adapter. Every report, good or bad, goes into the firmware notes.</p>`,
    },
    {
      h2: "Who made this firmware?",
      answer: "Shroom Labs wrote it from the community pin map. We are not made by or affiliated with the company behind Terrashroom.",
      faq: false,
      html: `<p>The pin facts come from Parker Ryan's ${cite("parkerRepo")}. Thank you, Parker. If anything here is wrong, <a href="/contact?topic=chamber">tell us</a> and we will fix it.</p>`,
    },
  ],
  sources: ["terrashroomUpdate", "parkerRepo", "parkerPinout", "redditGuide", "ownersThread", "espBoot", "espFlashVoltage", "firmware"],
  related: [
    ["Mushroom growing conditions for every species", "/grow"],
    ["How much humidity and fresh air mushrooms need", "/guides/humidity-and-fresh-air"],
    ["AC Infinity for mushrooms", "/ac-infinity"],
  ],
};

const chambers = {
  slug: "chambers",
  title: "Which mushroom chambers work with Shroom Labs?",
  h1: "Mushroom chambers that work with Shroom Labs",
  eyebrow: "Chambers and controllers",
  crumb: "Chambers",
  updated: "2026-11-05",
  description: "Shrooly is supported. Terrashroom and AC Infinity are community, untested. A Lykyn is on the bench. Inkbird and Tuya work as is with free grow profiles.",
  answer:
    "Shrooly is fully supported. Terrashroom has free community firmware and AC Infinity Wi-Fi controllers have a free community adapter, both untested on real hardware. A Lykyn Smart Mushroom Grow Box is on the bench: stock firmware stays on it, and a public Socket.IO stand-in in lykyn-adapter speaks the same protocol as Lykyn's cloud. Live LAN control still needs a TLS path the stock box trusts, or a logged-in cloud session. Inkbird and other Tuya Wi-Fi controllers keep their own software: set them from the free grow profiles, or automate them in Home Assistant. Any tub or box works with the profiles too.",
  cta: [
    ["Install on your Shrooly", "/install"],
    ["Terrashroom owners", "/terrashroom"],
  ],
  sections: [
    {
      h2: "Which chambers are supported?",
      answer: "Here is each one and what works today.",
      faq: false,
      html: tableHtml(),
    },
    {
      h2: "Does Shroom Labs work with Shrooly?",
      answer: "Yes. Shrooly is fully supported with free OpenShrooly firmware, grow profiles and the phone dashboard.",
      html: `<p>${cite("openshrooly")} by Graham Stewart replaces the stock software. You install it from <a href="/install">the install page</a> with a USB-C cable. Read <a href="/reuse-your-shrooly">reuse your Shrooly</a> first.</p>`,
    },
    {
      h2: "Does Shroom Labs work with Terrashroom?",
      answer: "Partly. We have free community firmware for it, but it is untested on real hardware.",
      html: `<p>It is written from a community pin map and builds cleanly, and we are looking for owners to try it. Read <a href="/terrashroom">Terrashroom after the shutdown</a> before you open a unit.</p>`,
    },
    {
      h2: "Do Inkbird controllers work with Shroom Labs?",
      answer: "They work as they are. Set the controller to the numbers in a grow profile, and Shroom Labs does not control it directly.",
      html: `<p>If you use Home Assistant, the community ${cite("tuyaLocal")} integration runs many Tuya based Wi-Fi controllers on your own network. Its list includes the Inkbird ITC306A and ITC308 plug in thermostats. An owner reported in ${a(SOURCES.ihc200.url, "a tuya-local issue")} that the IHC-200 humidity controller was detected as another device. We have not tested any of these ourselves.</p>`,
    },
    {
      h2: "Does AC Infinity work with Shroom Labs?",
      answer: "Partly. A free community adapter sets a Wi-Fi controller such as the Controller 69 PRO from a grow profile, but it is untested on real hardware.",
      html: `<p>Read <a href="/ac-infinity">AC Infinity for mushrooms</a> for how it works and what is untested. For Home Assistant, ${cite("aciBle")} is a community integration for local Bluetooth control of Controller 67 and 69 models. The controller takes one Bluetooth connection at a time, so close the phone app first. Wi-Fi models also work with ${cite("aciCloud")}, which signs in to your AC Infinity account. We have not tested either.</p>`,
    },
    {
      h2: "Does Shroom Labs work with Lykyn?",
      answer: "In progress. The box is on the bench with stock firmware, and a public Socket.IO stand-in speaks its cloud protocol. A live LAN push still needs a TLS cert the stock box trusts for lykyn.app, or a logged-in cloud session.",
      html: `<p>We drive it without flashing. The ${cite("lykynAdapter")} has the stand-in, Black Oyster example profiles, and protocol notes. Read <a href="/lykyn">Lykyn for mushrooms</a> and the <a href="/guides/lykyn-mushroom-grow-box-outside-control">outside-control guide</a>.</p>`,
    },
    {
      h2: "What if my chamber is not listed?",
      answer: "Use the free grow profiles. Every one lists the temperature, humidity, fresh air, and light for each stage, so you can set any chamber or tub by hand.",
      html: `<p>Start with <a href="/grow">mushroom growing conditions for every species</a>. If your chamber has an ESP32 inside and you want it supported, <a href="/contact?topic=chamber">tell us the model</a>.</p>`,
    },
    {
      h2: "What does each status mean?",
      answer: "Supported means we run it ourselves. Community, untested means our firmware or adapter exists but has not run on a real unit. On bench, outside control in progress means the chamber is here and the stock path is being proven. Use as is means you keep the stock software.",
      faq: false,
      html: `<p>We only mark a chamber supported once it has run our firmware on real hardware. When that changes for Terrashroom or Lykyn, this page will say so.</p>`,
    },
  ],
  sources: ["openshrooly", "terrashroomUpdate", "parkerRepo", "tuyaLocal", "ihc200", "aciBle", "aciCloud", "lykynAdapter"],
  related: [
    ["Terrashroom after the shutdown", "/terrashroom"],
    ["AC Infinity for mushrooms", "/ac-infinity"],
    ["Lykyn for mushrooms", "/lykyn"],
    ["Reuse your Shrooly", "/reuse-your-shrooly"],
    ["Shrooly shut down? Your options", "/shrooly-alternatives"],
    ["Mushroom growing conditions for every species", "/grow"],
  ],
};

const acInfinity = {
  slug: "ac-infinity",
  title: "AC Infinity Controller 69 PRO for mushrooms: tent fruiting chamber",
  h1: "AC Infinity for mushrooms",
  eyebrow: "For AC Infinity owners",
  crumb: "AC Infinity",
  updated: "2026-11-03",
  description: "Turn a grow tent or martha rack into a fruiting chamber with an AC Infinity Controller 69 PRO. A free community adapter sets it from a grow profile. Untested.",
  answer:
    "An AC Infinity Controller 69 PRO can run a mushroom fruiting chamber: a humidifier, an exhaust fan, and a heater on its ports, each switched by the chamber's humidity and temperature. Shroom Labs has a free community adapter that sets those ports from a grow profile through AC Infinity's cloud. It is untested on real hardware, so we are looking for owners to try it.",
  cta: [
    ["Help test it", "/contact?topic=chamber"],
    ["Build guide", "/guides/ac-infinity-mushroom-fruiting-chamber"],
  ],
  sections: [
    {
      h2: "Does the Controller 69 PRO work with Shroom Labs?",
      answer: "Yes, as a community, untested controller: our adapter writes grow profile numbers to it over AC Infinity's cloud, and nobody at Shroom Labs has run it on a real controller yet.",
      html: `<p>The 69 PRO has 4 UIS ports, runs each one at 10 speed levels, and connects to the AC Infinity app over Bluetooth or 2.4 GHz Wi-Fi (${cite("aciManual")}), and AC Infinity walks through its modes in its ${a(SOURCES.aciOverview.url, "Controller 69 PRO overview")}. The ${cite("aciCloud")} integration for Home Assistant lists the Controller 69 WiFi, 69 Pro, 69 Pro+ and AI+ as cloud capable. Our adapter is written from that integration's code, and handles the 69 WiFi, 69 PRO, and 69 PRO+. The AI+ uses a different write call and is not covered yet.</p>`,
    },
    {
      h2: "How does a grow tent become a fruiting chamber?",
      answer: "Put a humidifier, an exhaust fan, and a heater on the controller's ports, and let its sensor switch each one on the chamber's humidity and temperature.",
      html: `<ul>
        <li><strong>Humidifier.</strong> AUTO mode with the low humidity trigger. The manual says that trigger is for humidifiers: the port turns on when humidity falls to it.</li>
        <li><strong>Exhaust fan.</strong> CYCLE mode for fresh air on a schedule, on for a set time and off for the rest. The manual's high humidity and high temperature triggers are for exhaust fans too, if you would rather vent on those.</li>
        <li><strong>Heater.</strong> AUTO mode with the low temperature trigger, which the manual says is for heating.</li>
      </ul>
      <p>AC Infinity lists its CLOUDFORGE humidifiers, CLOUDLINE inline fans, CLOUDRAY clip fans, and THERMOFORGE heaters as working with the 69 PRO (${cite("aciEcosystem")}). A martha rack, a shelf unit with a zip cover, works the same way. The <a href="/guides/ac-infinity-mushroom-fruiting-chamber">build guide</a> has the parts and settings.</p>`,
    },
    {
      h2: "Can I plug a regular humidifier or heater into it?",
      answer: "A regular humidifier, yes, through the UIS Control Plug, but use a THERMOFORGE heater for heat.",
      html: `<p>The ${cite("aciPlug")} turns an outlet device on and off, with no speed control, and only works with devices that start on their own when they get power (${cite("aciOutlet")}). AC Infinity warns against using it for continuous high wattage loads such as heaters. A THERMOFORGE heater plugs straight into a UIS port.</p>`,
    },
    {
      h2: "How does the adapter set the controller from a grow profile?",
      answer: "It turns each stage into port settings, signs in to your AC Infinity account, reads each port, and writes the new values back.",
      html: `<ul>
        <li><strong>Humidifier port.</strong> AUTO, low humidity trigger at the stage humidity. Speed follows the profile's humidifier speed.</li>
        <li><strong>Heater port.</strong> AUTO, low temperature trigger at the stage temperature minus its hysteresis. Left alone when the stage turns heat off.</li>
        <li><strong>Fan port.</strong> CYCLE, on for the stage fan run and off for the rest of the period. Run times are rounded up to whole minutes, because the integration sets cycle times in minutes.</li>
      </ul>
      <p>Your email, password, controller, and ports come from environment variables on your own computer and are never stored by Shroom Labs. It is a dry run by default and prints the plan, and only writes when you add <code>--apply</code>. The code and its tests are in the ${cite("aciAdapter")}.</p>`,
    },
    {
      h2: "How hard is each way to connect?",
      answer: "The cloud is the easy way for Wi-Fi models, Bluetooth is harder work, and the base Controller 69 only has Bluetooth.",
      html: `<div class="table-wrap"><table class="conditions-table"><caption>Ways to talk to an AC Infinity controller, checked November 3, 2026</caption><thead><tr><th scope="col">Way</th><th scope="col">Effort</th><th scope="col">Works with</th></tr></thead><tbody>
        <tr><th scope="row">AC Infinity cloud</th><td>Easy. Your account email and password, no tools.</td><td>69 WiFi, 69 PRO, 69 PRO+, per ${cite("aciCloud")}. Needs internet.</td></tr>
        <tr><th scope="row">Bluetooth, fans</th><td>Medium. A Home Assistant box in range.</td><td>Controller 67 and 69, per ${cite("aciBle")}. One Bluetooth connection at a time.</td></tr>
        <tr><th scope="row">Bluetooth, full settings</th><td>Hard. Still being worked out by the community.</td><td>69 PRO, per ${cite("nyxBle")}. Writing the AUTO triggers over Bluetooth is not mapped yet.</td></tr>
      </tbody></table></div>
      <p>Our adapter uses the cloud. A local Bluetooth version would need no account, and we will add it when the community has the AUTO settings mapped.</p>`,
    },
    {
      h2: "What is untested?",
      answer: "All of it, on a real controller. The adapter passes our automated checks against a fake AC Infinity server, but has not written to a real 69 PRO yet.",
      html: `<ul>
        <li>Every write on a real controller.</li>
        <li>Whether the cloud accepts every value the profiles produce.</li>
        <li>How fast a CLOUDFORGE humidifier brings a tent to fruiting humidity.</li>
        <li>The AI+ controller. It is not supported yet.</li>
        <li>Bluetooth. It is not supported yet.</li>
      </ul>
      <p>The cloud API is not published by AC Infinity, so a change on their side could break it. If that happens, set the controller by hand from the <a href="/grow">grow profiles</a>.</p>`,
    },
    {
      h2: "Can I help test it?",
      answer: "Yes. If you own a Controller 69 PRO, message us and we will go through a first dry run and write with you.",
      html: `<p><a href="/contact?topic=chamber">Message us</a> and pick A chamber. Tell us your controller model and what is on each port. Every report, good or bad, goes into the adapter notes.</p>`,
    },
    {
      h2: "Who made this adapter?",
      answer: "Shroom Labs wrote it from the community Home Assistant integration. We are not made by or affiliated with AC Infinity.",
      faq: false,
      html: `<p>The endpoints and field names come from ${cite("aciCloud")} by dalinicus, released under the MIT license. Thank you. If anything here is wrong, <a href="/contact?topic=chamber">tell us</a> and we will fix it.</p>`,
    },
  ],
  sources: ["aciManual", "aciOverview", "aciEcosystem", "aciPlug", "aciOutlet", "aciCloud", "aciBle", "nyxBle", "aciAdapter"],
  related: [
    ["AC Infinity tent fruiting chamber build guide", "/guides/ac-infinity-mushroom-fruiting-chamber"],
    ["Chambers that work with Shroom Labs", "/chambers"],
    ["Terrashroom after the shutdown", "/terrashroom"],
    ["Mushroom growing conditions for every species", "/grow"],
  ],
};

const lykyn = {
  slug: "lykyn",
  title: "Lykyn Smart Mushroom Grow Box: outside control on the bench",
  h1: "Lykyn for mushrooms",
  eyebrow: "For Lykyn owners",
  crumb: "Lykyn",
  updated: CHAMBERS_UPDATED,
  description: "A Lykyn box is on the bench at Shroom Labs. Stock firmware stays. A public Socket.IO stand-in speaks the same protocol as Lykyn's cloud.",
  answer:
    "A Lykyn Smart Mushroom Grow Box is a countertop chamber with an official app. Shroom Labs drives it without flashing, through a Socket.IO stand-in that speaks the same protocol as Lykyn's cloud. The box is on the bench with a Black Oyster bag. Live LAN control still needs a TLS cert the stock box trusts for lykyn.app, or a logged-in cloud session.",
  cta: [
    ["Outside-control guide", "/guides/lykyn-mushroom-grow-box-outside-control"],
    ["See the adapter repo", LYKYN_ADAPTER],
    ["Grow log", "/grow-log"],
  ],
  sections: [
    {
      h2: "Does Shroom Labs work with Lykyn?",
      answer: "In progress. The box is on the bench with stock firmware, and a public Socket.IO stand-in speaks its cloud protocol. A live LAN push still needs a TLS cert the stock box trusts for lykyn.app, or a logged-in cloud session.",
      html: `<p>We leave the official firmware on the box. The ${cite("lykynAdapter")} accepts telemetry and pushes settings. Status is also on the <a href="/grow-log">grow log</a>.</p>`,
    },
    {
      h2: "What is a Lykyn Smart Mushroom Grow Box?",
      answer: "A countertop smart chamber with fans, a humidifier, lights, and a temp and humidity sensor, set up from an official app over Bluetooth and run day to day through Lykyn's cloud.",
      html: `<p>Lykyn sells a Single-Tier box and a two layer model. The company says you add water, put in a fruiting block, cut an X, and pick the species in the app (${cite("lykynSite")}). Our unit is a Single-Tier MUSHROOM box on firmware 0.17.0.</p>`,
    },
    {
      h2: "How does outside control work?",
      answer: "The box talks Socket.IO to lykyn.app. Our stand-in speaks the same events: it reads updateDevice telemetry and pushes settings the firmware applies.",
      html: `<p>The stand-in, CLI, and Black Oyster example profiles are in the ${cite("lykynAdapter")}. Credentials and device ids stay in a local .env and never go in git.</p>`,
    },
    {
      h2: "What still blocks a live LAN push?",
      answer: "TLS. The stock box verifies certificates for the hostname lykyn.app. A DNS override alone is not enough, and we will not reconfigure a home router until a trusted TLS path exists. A live LAN settings push is still untested on real hardware.",
      html: `<p>Two paths remain: terminate TLS in a way the stock box trusts, or drive settings through the owner's logged-in Lykyn cloud session. Details are in the adapter's dns-override doc.</p>
      <ul>
        <li>Whether a grow profile can be applied without using the Lykyn app by hand.</li>
        <li>How a Lykyn compares to a Shrooly chamber on the same species. That is the planned <a href="/grow-log">grow log</a>.</li>
      </ul>`,
    },
    {
      h2: "How is this different from OpenShrooly?",
      answer: "OpenShrooly replaces the stock software on a Shrooly chamber by flashing it. The Lykyn path leaves the stock software on the box and talks to it from outside.",
      html: `<p>Flashing is how we run a Shrooly chamber, and it is the untested plan for a Terrashroom. Lykyn is the other path: keep the official firmware and build an adapter around its cloud protocol. Read the <a href="/guides/lykyn-mushroom-grow-box-outside-control">outside-control guide</a> for the full split.</p>`,
    },
    {
      h2: "Can I help?",
      answer: "Yes, if you own a Lykyn. Message us with the model, Single-Tier or two layer, and what the official app lets you set.",
      html: `<p><a href="/contact?topic=chamber">Message us</a> and pick A chamber. We are not asking anyone to flash a Lykyn. Notes about what the app shows, and whether it works without the cloud, all help. Every report goes into the adapter notes.</p>`,
    },
    {
      h2: "Who made this page?",
      answer: "Shroom Labs. We are not made by or affiliated with Lykyn.",
      html: `<p>Product facts on this page come from the ${cite("lykynSite")} and from a read-only look at one stock box. If anything here is wrong, <a href="/contact?topic=chamber">tell us</a> and we will fix it.</p>`,
    },
  ],

  sources: ["lykynSite", "lykynAdapter"],
  related: [
    ["Lykyn outside-control guide", "/guides/lykyn-mushroom-grow-box-outside-control"],
    ["Shroom Labs grow log", "/grow-log"],
    ["Mushroom growing conditions for every species", "/grow"],
  ],
};export const CHAMBER_PAGES = [chambers, terrashroom, acInfinity, lykyn];

/** The searches these pages answer. */
export const TARGET_QUERIES = [
  "terrashroom",
  "terrashroom shut down",
  "what happened to terrashroom",
  "terrashroom firmware",
  "terrashroom esphome",
  "flash terrashroom",
  "terrashroom not working",
  "terrashroom gpio12",
  "mushroom chamber compatibility",
  "inkbird mushroom",
  "ac infinity mushroom",
  "ac infinity controller 69 pro mushroom",
  "ac infinity mushroom grow tent",
  "martha rack ac infinity",
  "ac infinity home assistant mushroom",
  "lykyn",
  "lykyn mushroom grow box",
  "lykyn smart mushroom grow box",
  "lykyn outside control",
  "lykyn shroom labs",
];
