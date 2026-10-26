/** Reference cluster: a plain glossary and a factual guide for owners whose Shrooly app stopped working. */
import { fruit, link, stage, temp } from "./data.js";

const UPDATED = "2026-10-26";

const term = (name, html) => `<dt>${name}</dt><dd>${html}</dd>`;
const terms = (...items) => `<dl class="glossary">${items.join("")}</dl>`;

const glossary = {
  slug: "mushroom-growing-glossary",
  title: "Mushroom growing glossary: plain definitions for home growers",
  h1: "Mushroom growing terms, explained plainly",
  eyebrow: "Reference",
  description: "Plain definitions of the words home mushroom growers use: mycelium, spawn, substrate, colonization, pinning, flush, casing, monotub, and more.",
  answer:
    "Mushroom growing has its own words, but the ideas are simple. Mycelium is the living network that eats the food you give it. Spawn is mycelium grown on grain, used to seed a bigger batch of substrate, which is the food. Colonization is the mycelium filling that food. Pinning is when tiny mushrooms appear. A flush is one wave of mushrooms. Below are the terms you will meet most, grouped by when you meet them.",
  sections: [
    {
      h2: "What are the basic parts of a mushroom?",
      html: terms(
        term("Mycelium", "The white, thread-like network that grows through food and digests it. It is the main body of the fungus. Mushrooms are its fruit."),
        term("Hyphae", "The single threads that make up mycelium."),
        term("Fruiting body", "The mushroom itself: cap, gills or spines, and stem. It exists to spread spores."),
        term("Spores", "Tiny cells a mushroom releases, a bit like seeds. Home growers of culinary mushrooms rarely start from spores, because a culture is faster and more reliable."),
        term("Spore print", "The pattern left when a cap drops spores on paper or foil. Used to help identify mushrooms."),
        term("Strain", "A line of one species with its own traits, such as speed, color, or temperature range.")
      ),
    },
    {
      h2: "What do spawn, substrate, and culture mean?",
      html: terms(
        term("Culture", "Living mycelium kept for starting new grows. It can be on agar or in liquid."),
        term("Liquid culture", "Mycelium growing in sterile sugar water, used to inoculate grain."),
        term("Agar", "A jelly in a dish used to grow and clean up cultures."),
        term("Inoculation", "Adding a culture or spawn to sterile grain or substrate to start it growing."),
        term("Spawn", "Mycelium grown on a carrier, usually grain, then mixed into a larger batch of substrate. Grain spawn is the most common kind."),
        term("Spawn rate", "How much spawn you mix in, compared with substrate. More spawn colonizes faster and leaves less room for mold."),
        term("Substrate", "The food the mycelium eats and fruits from: hardwood sawdust, straw, compost, or a mix."),
        term("Supplemented sawdust", "Hardwood sawdust with added bran or soy hulls for more food. It gives bigger yields but needs sterilizing."),
        term("Pasteurization", "Heating substrate enough to kill most competitors but not all. Common for straw."),
        term("Sterilization", "Heating under pressure to kill everything. Needed for grain and rich substrates."),
        term("Field capacity", "Substrate as wet as it can be without water dripping out when squeezed.")
      ),
    },
    {
      h2: "What are the stages of a grow called?",
      html: `${terms(
        term("Colonization", "The mycelium spreading through the substrate until it is white throughout. Usually warm and dark."),
        term("Fully colonized", "White all the way through, with little substrate showing. The point to start fruiting."),
        term("Pinning", "When tiny mushrooms, called pins, first form. It needs a change: cooler air, more fresh air, high humidity, and light."),
        term("Primordia", "Another word for pins: the first knots of a mushroom."),
        term("Fruiting", "Pins growing into full mushrooms."),
        term("Flush", "One wave of mushrooms. Most blocks give two or three, each smaller than the last."),
        term("Browning", "A shiitake stage where the block surface turns brown and tough before it fruits."),
        term("Cold shock", "A short spell of cold, or a cold soak, that tells some species to fruit."),
        term("Soaking", "Putting a block in cold water for some hours between flushes to put back moisture.")
      )}<p>In ${link("shiitake")}'s profile, browning lasts ${stage("shiitake", "browning").duration_days} days and the cold shock runs at ${temp(stage("shiitake", "cold_shock").temperature_c)}. Every species page lists each stage.</p>`,
    },
    {
      h2: "What do growing setup terms mean?",
      html: terms(
        term("Fruiting block", "A bag or block of colonized substrate ready to fruit. Most kits are fruiting blocks."),
        term("All-in-one bag", "A grow bag with grain and substrate in one, colonized in the same bag."),
        term("Filter patch", "The small square on a grow bag that lets air in and keeps mold spores out."),
        term("Monotub", "A plastic tub with holes, used as a simple fruiting chamber for bulk substrate."),
        term("Martha tent", "A small greenhouse shelf with a plastic cover, used to hold humidity around several blocks."),
        term("Casing layer", "A layer of damp peat or similar on top of substrate. Button mushrooms need it to pin."),
        term("Side fruiting", "Mushrooms growing from the sides of a bag or tub, often where light or air gets in."),
        term("Smart chamber", "An enclosed grower that controls humidity, light, and fresh air on its own. Some also manage temperature.")
      ),
    },
    {
      h2: "What do air and humidity terms mean?",
      html: `${terms(
        term("Humidity", "How much water the air holds, as a percent of the most it could hold at that temperature. Fruiting mushrooms usually want 80 to 95%."),
        term("Fresh air", "Air changes that clear carbon dioxide. Short for fresh air exchange."),
        term("Carbon dioxide", "The gas mushrooms breathe out. High levels give long stems and small caps."),
        term("Hygrometer", "A meter that reads humidity. Cheap ones are often off by a few percent."),
        term("Misting", "Spraying fine water on chamber walls to raise humidity.")
      )}<p>For example, ${link("pearl-oyster")} fruits at ${fruit("pearl-oyster").humidity_percent}% humidity in its profile. Read <a href="/guides/humidity-and-fresh-air">humidity and fresh air for mushrooms</a> for more.</p>`,
    },
    {
      h2: "What do problem terms mean?",
      html: terms(
        term("Contamination", "Anything growing in your substrate that is not your mushroom: mold or bacteria. See <a href=\"/guides/mushroom-contamination\">mushroom contamination</a>."),
        term("Trichoderma", "A common green mold that takes over substrate."),
        term("Cobweb mold", "A gray, wispy mold that spreads very fast."),
        term("Bacterial blotch", "Yellow or brown sticky spots on caps, often from standing water."),
        term("Metabolites", "Yellow or amber drops the mycelium makes. Normal, not mold."),
        term("Leggy", "Long, thin stems with small caps, usually from too little fresh air. See <a href=\"/guides/leggy-mushroom-stems\">leggy mushroom stems</a>."),
        term("Aborts", "Pins that stop growing and dry out, often from low humidity.")
      ),
    },
  ],
  faq: [
    {
      q: "What is the difference between spawn and substrate?",
      a: "Spawn is mycelium already growing on grain, used like a starter. Substrate is the bigger batch of food, such as sawdust or straw, that the spawn colonizes and fruits from.",
    },
    {
      q: "What does fully colonized mean?",
      a: "The substrate is white with mycelium all the way through and feels firm. That is the point to start fruiting conditions.",
    },
    {
      q: "What is a flush of mushrooms?",
      a: "One wave of mushrooms from a block. After a harvest the block rests, then can give another, usually smaller, flush.",
    },
    {
      q: "What are pins in mushroom growing?",
      a: "Pins are the first tiny mushrooms that form on a colonized block. They grow into full mushrooms over the next few days.",
    },
  ],
  related: [
    ["How to grow mushrooms at home", "/guides/grow-mushrooms-at-home"],
    ["Humidity and fresh air for mushrooms", "/guides/humidity-and-fresh-air"],
    ["Mushrooms not pinning", "/guides/mushrooms-not-pinning"],
    ["Conditions for every species", "/grow"],
  ],
  updated: UPDATED,
};

const OPEN = '<a href="https://openshrooly.com/" rel="noopener">OpenShrooly</a>';

const app = {
  slug: "shrooly-app-not-working",
  title: "Shrooly app not working? How to keep using your Shrooly chamber",
  h1: "Shrooly app not working? What you can do",
  eyebrow: "Shrooly device owners",
  description: "If the Shrooly app will not log in or start a grow, you can still use the chamber. What owners report, quick checks, and how OpenShrooly runs it over Wi-Fi.",
  answer:
    "Since about August 2025, many owners report that the Shrooly app will not log in or start a grow, often with a no internet connection error, and that support does not reply. If that is what you see, the problem is likely on the app's servers, not your phone. You can still use the chamber: free, open source OpenShrooly firmware runs it over your own Wi-Fi from a web page, with no app or cloud account.",
  sections: [
    {
      h2: "What is happening with the Shrooly app?",
      html: `<p>The original Shrooly chamber talks to a phone app over Bluetooth, and owners report the app needs a working connection to the company's servers to start a grow program. From August 2025, posts from owners describe the same things: the app will not log in, it says there is no internet connection when there is, pods cannot be ordered, and support emails go unanswered. The ${OPEN} project site says the company appears to have gone out of business.</p>
<p>Shroom Labs is not part of the company that made Shrooly devices and has no inside information. We only know what owners report and what we see in public.</p>`,
    },
    {
      h2: "What should you check first?",
      html: `<ol>
<li>Update the app and your phone, then restart both the phone and the chamber.</li>
<li>Check that Bluetooth is on and the app is allowed to use it. On Android, the app may also need location permission to find Bluetooth devices.</li>
<li>Try on Wi-Fi and on mobile data.</li>
<li>Stand close to the chamber while connecting.</li>
</ol>
<p>If other apps work but the Shrooly app still says there is no internet connection or will not log in, more phone fixes are unlikely to help.</p>`,
    },
    {
      h2: "Can you use a Shrooly chamber without the app?",
      html: `<p>Yes. ${OPEN} is free, open source replacement firmware for the Shrooly chamber, started by Graham Stewart. It turns the chamber into a Wi-Fi device you control from a web page on your phone or computer. It can also connect to Home Assistant. Nothing depends on the company's servers.</p>
<p>It is an experimental hobby project. Many owners have installed it, but it is used at your own risk.</p>`,
    },
    {
      h2: "How do you install OpenShrooly?",
      html: `<ol>
<li>Write down your current humidity, light, and fan settings, and finish or remove any grow in progress.</li>
<li>If you may want to go back, back up the original firmware first. The ${OPEN} documentation covers it.</li>
<li>Use a computer with Chrome or Edge and a USB-C data cable, not a charge-only cable.</li>
<li>Run the installer, from the OpenShrooly site or from the <a href="/install">Shroom Labs install page</a>, which offers releases signed by Shroom Labs when one is published.</li>
<li>Join the chamber to your Wi-Fi and open its page in a browser.</li>
</ol>
<p>Read the <a href="/docs">Shroom Labs docs</a> for how profiles, the Hub, and the chamber fit together.</p>`,
    },
    {
      h2: "What settings should you use once it runs?",
      html: `<p>The app used to pick settings for you. Now you choose them, stage by stage. Every Shroom Labs profile lists temperature, humidity, light, and fresh air for each stage of one species. For example, ${link("lions-mane")} fruits at ${temp(fruit("lions-mane").temperature_c)} and ${fruit("lions-mane").humidity_percent}% humidity, and ${link("pearl-oyster")} at ${fruit("pearl-oyster").humidity_percent}% humidity.</p>
<p>See <a href="/grow">conditions for every species</a>, or start with the <a href="/guides/easiest-mushrooms-to-grow">easiest mushrooms to grow</a>.</p>`,
    },
    {
      h2: "What can you grow without the original pods?",
      html: `<p>Owners report the original pods are no longer for sale. You do not need them. Any fruiting block or all-in-one grow bag that fits in the chamber works. Some owners split a large colonized bag in half and fruit one half after the other. Buy blocks from a supplier that sells clean, labeled cultures, and pick a forgiving species first, like an oyster or lion's mane.</p>
<p>Read <a href="/guides/grow-mushrooms-at-home">how to grow mushrooms at home</a> for the full process.</p>`,
    },
  ],
  faq: [
    {
      q: "Has the company behind the Shrooly app shut down?",
      a: "We do not know of a public statement from the company. Since August 2025 many owners report the app and support stopped working, and the OpenShrooly project site says the company appears to have gone out of business.",
    },
    {
      q: "Why does the Shrooly app say there is no internet connection?",
      a: "Owners see this error even when their phone is online. It usually means the app cannot reach the company's servers, not that your phone has a problem.",
    },
    {
      q: "Is my Shrooly device useless without the app?",
      a: "No. With OpenShrooly firmware it runs over your own Wi-Fi from a web page, and you set temperature, humidity, light, and fresh air for each stage.",
    },
    {
      q: "Does OpenShrooly need the cloud?",
      a: "No. It runs on the chamber and your home network. Linking to an online account is optional.",
    },
    {
      q: "Is installing OpenShrooly safe?",
      a: "Many owners have installed it, but it is experimental and could leave the chamber unusable if something goes wrong. Back up the original firmware first if you may want to go back.",
    },
  ],
  related: [
    ["Grow kit vs monotub vs smart chamber", "/guides/grow-kit-vs-monotub-vs-smart-chamber"],
    ["Easiest mushrooms to grow at home", "/guides/easiest-mushrooms-to-grow"],
    ["Conditions for every species", "/grow"],
  ],
  updated: UPDATED,
};

export const REFERENCE_GUIDES = [glossary, app];
