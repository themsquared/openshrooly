/**
 * Chamber pages: the /chambers compatibility hub and the /terrashroom owner page.
 *
 * Rules for this file (checked by api/test/chambers.test.js):
 * - Every status is honest. Shrooly is supported. Terrashroom is community firmware,
 *   untested on real hardware. Controllers we do not run keep their own software.
 * - Every fact about another company links a public source in `sources`.
 *   No unit counts, no guesses about money or motives.
 * - Each question h2 is answered by its first sentence. Those become FAQPage markup.
 * - Plain words: no dashes, no arrows.
 */

export const CHAMBERS_UPDATED = "2026-10-27";
export const CHECKED = "October 27, 2026";

const REPO = "https://github.com/themsquared/openshrooly/tree/cursor/community-platform-fa9c/esphome/terrashroom";
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
    status: "Use as is",
    how: "Keep the stock app. Set it from a grow profile, or automate it in Home Assistant over Bluetooth with a community integration. Shroom Labs does not control it directly.",
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
  ],
};

const chambers = {
  slug: "chambers",
  title: "Which mushroom chambers work with Shroom Labs?",
  h1: "Mushroom chambers that work with Shroom Labs",
  eyebrow: "Chambers and controllers",
  crumb: "Chambers",
  updated: CHAMBERS_UPDATED,
  description: "Shrooly is supported. Terrashroom has community firmware, untested. Inkbird, Tuya, and AC Infinity controllers work as is with our free grow profiles.",
  answer:
    "Shrooly is fully supported. Terrashroom has free community firmware that is untested on real hardware. Inkbird and other Tuya Wi-Fi controllers, and AC Infinity controllers, keep their own software: set them from the free grow profiles, or automate them in Home Assistant. Any tub or box works with the profiles too.",
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
      answer: "It works as it is. Set the fan and humidity triggers from a grow profile in its own app, and Shroom Labs does not control it directly.",
      html: `<p>For Home Assistant, ${cite("aciBle")} is a community integration for local Bluetooth control of Controller 67 and 69 models. The controller takes one Bluetooth connection at a time, so close the phone app first. Wi-Fi models also work with ${cite("aciCloud")}, which signs in to your AC Infinity account. We have not tested either.</p>`,
    },
    {
      h2: "What if my chamber is not listed?",
      answer: "Use the free grow profiles. Every one lists the temperature, humidity, fresh air, and light for each stage, so you can set any chamber or tub by hand.",
      html: `<p>Start with <a href="/grow">mushroom growing conditions for every species</a>. If your chamber has an ESP32 inside and you want it supported, <a href="/contact?topic=chamber">tell us the model</a>.</p>`,
    },
    {
      h2: "What does each status mean?",
      answer: "Supported means we run it ourselves. Community, untested means the firmware exists but has not run on a real unit. Use as is means you keep the stock software.",
      faq: false,
      html: `<p>We only mark a chamber supported once it has run our firmware on real hardware. When that changes for Terrashroom, this page will say so.</p>`,
    },
  ],
  sources: ["openshrooly", "terrashroomUpdate", "parkerRepo", "tuyaLocal", "ihc200", "aciBle", "aciCloud"],
  related: [
    ["Terrashroom after the shutdown", "/terrashroom"],
    ["Reuse your Shrooly", "/reuse-your-shrooly"],
    ["Shrooly shut down? Your options", "/shrooly-alternatives"],
    ["Mushroom growing conditions for every species", "/grow"],
  ],
};

export const CHAMBER_PAGES = [chambers, terrashroom];

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
];
