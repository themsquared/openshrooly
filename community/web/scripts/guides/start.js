/** Start here cluster: the pillar guide and the two comparison guides. */
import { days, fruit, link, profile, stage, temp } from "./data.js";
import { supplier } from "./suppliers.js";

const UPDATED = "2026-10-26";


function speciesRow(id) {
  const p = profile(id);
  const fr = fruit(id);
  return `<tr><th scope="row">${link(id)}</th><td>${temp(fr.temperature_c)}</td><td>${fr.humidity_percent}%</td><td>${days(id)}</td></tr>`;
}

function speciesTable(ids, caption) {
  return `<div class="table-wrap"><table class="conditions-table"><caption>${caption}</caption><thead><tr><th scope="col">Mushroom</th><th scope="col">Fruiting temperature</th><th scope="col">Fruiting humidity</th><th scope="col">Days, start to first harvest window</th></tr></thead><tbody>${ids.map(speciesRow).join("")}</tbody></table></div>`;
}

const pillar = {
  slug: "grow-mushrooms-at-home",
  title: "How to grow mushrooms at home: step by step for beginners",
  h1: "How to grow mushrooms at home",
  eyebrow: "Start here",
  description:
    "The simple way to grow mushrooms at home: pick an easy species, then manage humidity, fresh air, light, and temperature through each stage. Step by step.",
  answer: `The easiest way to grow mushrooms at home is to start with an oyster or lion's mane kit or a colonized block, keep it at 85 to 95% humidity with regular fresh air, give it indirect light, and keep the room cool. Most kits start forming mushrooms one to two weeks after you open them. When that works, a fruiting chamber makes every grow repeatable.`,
  sections: [
    {
      h2: "What do mushrooms need to grow?",
      html: `<p>Every culinary mushroom needs the same five things. Get these right and most grows succeed.</p>
<ul>
<li><strong>Food.</strong> Mycelium, the root network of the fungus, eats a substrate such as hardwood sawdust, straw, or grain. A kit or block already has this done for you.</li>
<li><strong>Humidity.</strong> Young mushrooms are mostly water and dry out fast. Most species fruit best between 85 and 95% humidity.</li>
<li><strong>Fresh air.</strong> Mycelium breathes out carbon dioxide. If it builds up, mushrooms grow long thin stems and small caps, or do not form at all.</li>
<li><strong>Light.</strong> Mushrooms do not use light for food, but light tells them which way is up and when to fruit. Indirect daylight or about 12 hours of room light a day is enough. Enoki and button mushrooms are the exceptions and fruit in the dark.</li>
<li><strong>The right temperature.</strong> Most species colonize warm and fruit cooler. ${link("blue-oyster")} fruits at ${temp(fruit("blue-oyster").temperature_c)} in its profile, while ${link("pink-oyster")} wants ${temp(fruit("pink-oyster").temperature_c)}.</li>
</ul>`,
    },
    {
      h2: "What are the stages of growing mushrooms?",
      html: `<ol>
<li><strong>Colonization.</strong> Mycelium spreads through the substrate in warm, dark, still conditions. ${link("lions-mane")} colonizes for ${stage("lions-mane", "colonization").duration_days} days at ${temp(stage("lions-mane", "colonization").temperature_c)} in its profile.</li>
<li><strong>Pinning.</strong> Cooler air, higher humidity, more fresh air, and light tell the block to start tiny mushrooms called pins. This takes a few days to a week for most species.</li>
<li><strong>Fruiting.</strong> Pins grow into full mushrooms. Humidity stays high and fresh air goes up as the mushrooms get bigger.</li>
<li><strong>Harvest and rest.</strong> Pick before the caps flatten and drop spores, then let the block rest and fruit again. Most blocks give two or three flushes.</li>
</ol>
<p>Every species page on this site has a <a href="/grow">stage by stage table</a> with temperature, humidity, fresh air, light, and days.</p>`,
    },
    {
      h2: "Which mushroom should a beginner grow first?",
      html: `<p>Start with oyster mushrooms or lion's mane. They colonize fast, forgive small mistakes, and show you quickly if something is wrong. In this library ${link("pearl-oyster")} runs about ${days("pearl-oyster")} days from the start of colonization to the end of the first harvest window, and ${link("lions-mane")} about ${days("lions-mane")} days. Read <a href="/guides/easiest-mushrooms-to-grow">the easiest mushrooms to grow at home</a> for a full list.</p>
${speciesTable(["pearl-oyster", "blue-oyster", "lions-mane", "pink-oyster"], "Good first mushrooms, from their profiles")}`,
    },
    {
      h2: "What is the best way to grow mushrooms at home?",
      html: `<p>There are three common setups. Pick the one that matches how much time you want to spend.</p>
<ul>
<li><strong>A grow kit.</strong> A colonized block in a bag or box. You cut it open, mist it, and wait. Cheapest and simplest, but results depend on the room you leave it in.</li>
<li><strong>A tub or monotub.</strong> A plastic tub with holes for air, filled with colonized bulk substrate. Bigger harvests, more hands on work, and you need clean technique.</li>
<li><strong>A fruiting chamber.</strong> A box that holds humidity, fresh air, light, and sometimes temperature for you. A Shrooly chamber running OpenShrooly follows a grow profile stage by stage.</li>
</ul>
<p>The full comparison is in <a href="/guides/grow-kit-vs-monotub-vs-smart-chamber">grow kit vs monotub vs smart chamber</a>.</p>`,
    },
    {
      h2: "How do you grow mushrooms from a kit, step by step?",
      html: `<ol>
<li><strong>Check the block.</strong> It should be white with mycelium all the way through. A few yellow drops are normal. Green, black, or pink patches are mold.</li>
<li><strong>Open it where the kit says.</strong> Usually a cut or an X in the bag on one side. Mushrooms grow out of the opening.</li>
<li><strong>Find a spot.</strong> Out of direct sun, away from heaters and fans that dry the air, and in a room near the fruiting temperature for your species.</li>
<li><strong>Keep it humid.</strong> Mist the air around the opening two or three times a day, or put the block in a humidity tent or chamber. Mist the walls, not the pins.</li>
<li><strong>Give it air.</strong> Fan the tent a few times a day or leave holes for air. Stuffy air gives long stems and small caps.</li>
<li><strong>Harvest on time.</strong> Twist or cut the cluster off at the base when the caps are mostly open but the edges still curl down a little.</li>
<li><strong>Rest and repeat.</strong> Let the block sit for a week or two, then soak or mist it and start again.</li>
</ol>`,
    },
    {
      h2: "How much humidity and fresh air do mushrooms need?",
      html: `<p>Most culinary mushrooms fruit between 85 and 95% humidity. Fresh air matters just as much: oysters need a lot, lion's mane and shiitake need less. The profiles set a different humidity and fan rate for each stage. Too little humidity shows as dry, cracked caps and pins that stall. Too little fresh air shows as long stems and small caps.<span data-needs="humidity-and-fresh-air"> More on both in <a href="/guides/humidity-and-fresh-air">humidity and fresh air for mushrooms</a>.</span></p>`,
    },
    {
      h2: "What usually goes wrong?",
      html: `<ul>
<li><a href="/guides/mushrooms-not-pinning">No pins after colonization</a>: usually not enough fresh air, light, or a temperature drop.</li>
<li><a href="/guides/leggy-mushroom-stems">Long, thin stems</a>: too much carbon dioxide or too little light.</li>
<li><a href="/guides/dry-cracked-mushroom-caps">Dry, cracked caps</a>: humidity too low or air blowing straight on the caps.</li>
<li><a href="/guides/mushroom-contamination">Green, black, or slimy patches</a>: mold or bacteria.</li>
</ul>`,
    },
    {
      h2: "Where can you buy mushroom kits and spawn?",
      html: `<p>Buy from a supplier that sells clean, labeled cultures and stands behind them. ${supplier("north-spore")} sells kits, spawn, and supplies. ${supplier("pnw-spore")} is another source of culinary liquid cultures.</p>`,
    },
  ],
  faq: [
    {
      q: "How long does it take to grow mushrooms at home?",
      a: `From a ready kit, most oysters and lion's mane give a first harvest in two to three weeks. From the start of colonization, the profiles here run from about ${days("pink-oyster")} days for pink oyster to about ${days("shiitake")} days for shiitake.`,
    },
    {
      q: "Can you grow mushrooms indoors?",
      a: "Yes. Indoors is the easiest place to control humidity, temperature, and light. A kitchen counter, a shelf, or a closet with some light all work as long as the mushrooms get fresh air.",
    },
    {
      q: "Do mushrooms need light to grow?",
      a: "They do not need light for food, but most species need some light to start pins and grow normal caps. About 12 hours a day of indirect daylight or room light is enough for most culinary mushrooms.",
    },
    {
      q: "How many times can a mushroom block fruit?",
      a: "Most blocks give two or three flushes. Each flush is usually smaller than the one before. When a block stops fruiting or turns soft and smelly, compost it.",
    },
    {
      q: "Is it safe to grow mushrooms at home?",
      a: "Growing culinary mushrooms is safe for most people. Oysters release a lot of spores once the caps flatten, so harvest before that and keep large grows out of bedrooms if you have allergies. Only eat mushrooms you grew from a known culture.",
    },
  ],
  related: [
    ["Easiest mushrooms to grow at home", "/guides/easiest-mushrooms-to-grow"],
    ["Grow kit vs monotub vs smart chamber", "/guides/grow-kit-vs-monotub-vs-smart-chamber"],
    ["Temperature and humidity for every species", "/grow"],
  ],
  updated: UPDATED,
};

const BEGINNER = ["pearl-oyster", "blue-oyster", "pink-oyster", "golden-oyster", "elm-oyster", "lions-mane"];

const easiest = {
  slug: "easiest-mushrooms-to-grow",
  title: "Easiest mushrooms to grow at home, ranked for beginners",
  h1: "What is the easiest mushroom to grow at home?",
  eyebrow: "Start here",
  description:
    "Oyster mushrooms are the easiest to grow at home, with lion's mane close behind. Compare beginner species by temperature, humidity, and days to harvest.",
  answer: `Oyster mushrooms are the easiest mushroom to grow at home. Pearl and blue oyster colonize fast, shrug off small mistakes, and run about ${days("pearl-oyster")} and ${days("blue-oyster")} days in their profiles from the start of colonization to the end of the first harvest window. Lion's mane is a close second and just as good in a kit.`,
  sections: [
    {
      h2: "Which mushrooms are easiest for beginners?",
      html: `${speciesTable(BEGINNER, "Beginner mushrooms, from their profiles")}
<p>All six are tagged beginner in this library. They grow on common hardwood or straw substrates, fruit at room temperature or a little below, and show you fast when something is off.</p>`,
    },
    {
      h2: "Why are oyster mushrooms the easiest?",
      html: `<ul>
<li><strong>Fast.</strong> Oysters colonize quickly, so mold has less time to get a start.</li>
<li><strong>Forgiving.</strong> They fruit across a wide range of humidity and temperature.</li>
<li><strong>Clear signals.</strong> If the air is stale you see long stems within days, so you learn fast.</li>
</ul>
<p>The one thing oysters ask for is plenty of fresh air. The ${link("pearl-oyster")} profile runs its fan harder in fruiting than most other species.</p>`,
    },
    {
      h2: "Which oyster should you pick for your room temperature?",
      html: `<ul>
<li><strong>Cool room:</strong> ${link("blue-oyster")} fruits at ${temp(fruit("blue-oyster").temperature_c)}.</li>
<li><strong>Normal room:</strong> ${link("pearl-oyster")} fruits at ${temp(fruit("pearl-oyster").temperature_c)}.</li>
<li><strong>Warm room or summer:</strong> ${link("golden-oyster")} at ${temp(fruit("golden-oyster").temperature_c)} or ${link("pink-oyster")} at ${temp(fruit("pink-oyster").temperature_c)}.</li>
</ul>`,
    },
    {
      h2: "Is lion's mane easy to grow?",
      html: `<p>Yes. ${link("lions-mane")} is one of the easiest mushrooms to grow from a kit. It needs less fresh air than oysters but likes high humidity, ${fruit("lions-mane").humidity_percent}% while fruiting in its profile. Yellowing spines usually mean dry air or an old fruit. A pink tint often comes from cool air or strong light.</p>`,
    },
    {
      h2: "What do you need for a first grow?",
      html: `<ul>
<li><strong>A colonized block or kit</strong> of one of the species above.</li>
<li><strong>A spray bottle</strong> for misting, or a humidity tent or chamber that holds humidity for you.</li>
<li><strong>A spot with indirect light</strong> and no heater or fan blowing on it.</li>
<li><strong>Clean hands and a clean knife</strong> for opening the bag and harvesting.</li>
</ul>
<p>That is all. Grain, pressure cookers, and sterile work only come in when you want to make your own blocks.</p>`,
    },
    {
      h2: "How long until you can eat them?",
      html: `<p>From a fully colonized kit, oysters usually show pins within one to two weeks and are ready a few days later. From the start of colonization, the beginner profiles here run from about ${days("pink-oyster")} days for ${link("pink-oyster")} to about ${days("lions-mane")} days for ${link("lions-mane")}. Each profile page has a day by day timeline.</p>
<p>Pick oysters when the cap edges are still curled down a little, before they flatten and drop spores. Pick lion's mane when the spines are about half a centimeter long and before it starts to yellow.</p>`,
    },
    {
      h2: "Which mushrooms should beginners skip at first?",
      html: `<ul>
<li>${link("shiitake")}: about ${days("shiitake")} days in its profile, with a long browning stage and a cold shock.</li>
<li>${link("button-cremini")}: grows on compost with a casing layer, which is a different skill set.</li>
<li>${link("maitake")}, ${link("reishi")}, and ${link("cordyceps-militaris")}: slow or picky. Great second or third projects.</li>
</ul>`,
    },
  ],
  faq: [
    {
      q: "What is the fastest mushroom to grow at home?",
      a: `Pink oyster is the fastest profile here at about ${days("pink-oyster")} days from the start of colonization to the end of the first harvest window. It likes warm rooms around ${temp(fruit("pink-oyster").temperature_c)}.`,
    },
    {
      q: "What is the easiest mushroom to grow without a kit?",
      a: "Oyster mushrooms on pasteurized straw or on a ready made sawdust block. They colonize fast enough to outrun most molds.",
    },
    {
      q: "Can mushrooms grow at room temperature?",
      a: `Yes. ${profile("pearl-oyster").name} fruits at ${temp(fruit("pearl-oyster").temperature_c)} and ${profile("golden-oyster").name} at ${temp(fruit("golden-oyster").temperature_c)} in their profiles, both close to a normal room. Pick the species that matches your room rather than fighting it.`,
    },
    {
      q: "Can you grow lion's mane and oyster in the same room?",
      a: "Yes, but oysters drop many spores once their caps flatten. Harvest oysters on time so their spores do not land on other blocks.",
    },
  ],
  related: [
    ["How to grow mushrooms at home", "/guides/grow-mushrooms-at-home"],
    ["Grow kit vs monotub vs smart chamber", "/guides/grow-kit-vs-monotub-vs-smart-chamber"],
    ["All species and their conditions", "/grow"],
  ],
  updated: UPDATED,
};

const compare = {
  slug: "grow-kit-vs-monotub-vs-smart-chamber",
  title: "Grow kit vs monotub vs smart chamber: best way to grow mushrooms",
  h1: "Grow kit vs monotub vs smart chamber",
  eyebrow: "Compare",
  description:
    "A plain comparison of mushroom grow kits, monotubs, and smart fruiting chambers: effort, control, harvest size, and who each one suits best.",
  answer:
    "A grow kit is the cheapest and simplest way to get a first harvest. A monotub gives bigger harvests from bulk substrate but takes more hands on work and clean technique. A smart fruiting chamber holds humidity, fresh air, and light for you, and some also manage temperature, so results repeat, but it costs more up front.",
  sections: [
    {
      h2: "How do they compare side by side?",
      html: `<div class="table-wrap"><table class="conditions-table"><caption>Three ways to grow mushrooms at home</caption><thead><tr><th scope="col"></th><th scope="col">Grow kit</th><th scope="col">Monotub</th><th scope="col">Smart chamber</th></tr></thead><tbody>
<tr><th scope="row">Setup</th><td>Open the box</td><td>Drill holes, prepare substrate</td><td>Plug in, pick a profile</td></tr>
<tr><th scope="row">Daily work</th><td>Mist two or three times</td><td>Check and fan once or twice</td><td>Refill water, harvest</td></tr>
<tr><th scope="row">Control</th><td>Whatever your room gives</td><td>Humidity by hand, air by holes</td><td>Humidity, fan, light, and stage timing set by profile</td></tr>
<tr><th scope="row">Harvest size</th><td>One block</td><td>Largest</td><td>One or two blocks at a time</td></tr>
<tr><th scope="row">Best for</th><td>A first try</td><td>Bulk harvests, hobby growers</td><td>Repeatable grows with little daily work</td></tr>
</tbody></table></div>`,
    },
    {
      h2: "Is a grow kit worth it?",
      html: "<p>Yes, for a first grow. A kit removes the hardest part, getting a clean colonized block. The weak spot is the room. Dry winter air or a warm kitchen can stall it, and a kit left in dry air often gives one small flush and stops. A simple humidity tent fixes most of that.</p>",
    },
    {
      h2: "What is a monotub and who is it for?",
      html: "<p>A monotub is a plastic storage tub with a few holes for air, filled with colonized bulk substrate. It holds humidity on its own and can give large harvests. It suits growers who already make or buy grain spawn and are comfortable with clean technique. Too many holes dry the surface. Too few give stale air.</p>",
    },
    {
      h2: "What does a smart fruiting chamber do?",
      html: `<p>A smart chamber is a small box with a humidifier, a fan, lights, and sensors. It reads the air and adjusts on its own. A Shrooly chamber running OpenShrooly loads a grow profile, then moves from colonization to pinning to fruiting on schedule, changing humidity, fan, and light at each stage. Every <a href="/grow">species profile</a> on this site is free to load.</p>`,
    },
    {
      h2: "What about a grow tent or shelf setup?",
      html: "<p>A wire shelf in a clear plastic cover, often called a martha tent, sits between a monotub and a smart chamber. It fits several blocks and you add a humidifier and fan yourself. It is a good next step once one block at a time feels too small.</p>",
    },
    {
      h2: "How much space does each need?",
      html: "<ul><li><strong>Grow kit:</strong> a spot on a counter or shelf about the size of a shoebox.</li><li><strong>Monotub:</strong> a storage tub, often 50 to 70 liters, plus room to prepare substrate.</li><li><strong>Smart chamber:</strong> a countertop footprint, with a power outlet nearby.</li><li><strong>Shelf tent:</strong> floor space for a wire shelf, often in a spare room or garage.</li></ul>",
    },
    {
      h2: "What usually goes wrong with each?",
      html: "<ul><li><strong>Grow kit:</strong> dry air. Caps crack and pins stall when the room is dry.</li><li><strong>Monotub:</strong> contamination. Bulk substrate gives mold more room if anything was not clean.</li><li><strong>Smart chamber:</strong> an empty water tank or a profile that does not match the species. Check the tank and pick the right profile.</li><li><strong>Shelf tent:</strong> uneven conditions. The top shelf is often warmer and drier than the bottom.</li></ul>",
    },
    {
      h2: "Which should you choose?",
      html: `<ul>
<li>Never grown before: start with a kit, ideally ${link("pearl-oyster", "oyster")} or ${link("lions-mane", "lion's mane")}.</li>
<li>Want the biggest harvest for the money: monotub or shelf tent.</li>
<li>Want the same result every time with little daily work: a smart chamber.</li>
</ul>`,
    },
  ],
  faq: [
    {
      q: "Do you need a fruiting chamber to grow mushrooms?",
      a: "No. A kit on a counter or in a humidity tent can fruit well. A chamber just makes humidity and fresh air steady, which matters most in dry or warm homes.",
    },
    {
      q: "Is a monotub better than a grow kit?",
      a: "It can give a much bigger harvest, but it asks more of you. A kit is better for a first grow because the hard part is done.",
    },
    {
      q: "Can you grow oyster mushrooms in a monotub?",
      a: "You can, but oysters need a lot of fresh air and do better in bags, buckets with holes, or a tent with good airflow.",
    },
    {
      q: "What is an automated mushroom fruiting chamber?",
      a: "A box with a humidifier, fan, lights, and sensors that holds the conditions a mushroom needs and changes them by stage. You still harvest by hand.",
    },
  ],
  related: [
    ["How to grow mushrooms at home", "/guides/grow-mushrooms-at-home"],
    ["Easiest mushrooms to grow at home", "/guides/easiest-mushrooms-to-grow"],
    ["Profiles for Shrooly chambers", "/grow"],
  ],
  updated: UPDATED,
};

export const START_GUIDES = [pillar, easiest, compare];
