/** Problems cluster: humidity and fresh air, then the four most common grow problems. */
import { air, fruit, link, profile, range, stage, temp } from "./data.js";

const UPDATED = "2026-10-26";

const [fruitHumLo, fruitHumHi] = range("fruiting", "humidity_percent");
const [pinHumLo, pinHumHi] = range("pinning", "humidity_percent");

function humidityRow(id) {
  const pin = stage(id, "pinning");
  const fr = fruit(id);
  return `<tr><th scope="row">${link(id)}</th><td>${pin.humidity_percent}%</td><td>${fr.humidity_percent}%</td><td>every ${fr.fan.period_min} min</td></tr>`;
}

function dropRow(id) {
  const col = stage(id, "colonization");
  const pin = stage(id, "pinning");
  return `<tr><th scope="row">${link(id)}</th><td>${temp(col.temperature_c)}</td><td>${temp(pin.temperature_c)}</td><td>${pin.humidity_percent}%</td></tr>`;
}

const table = (caption, heads, rows) =>
  `<div class="table-wrap"><table class="conditions-table"><caption>${caption}</caption><thead><tr>${heads.map((h) => `<th scope="col">${h}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;

const humidity = {
  slug: "humidity-and-fresh-air",
  title: "Mushroom humidity and fresh air: how much do mushrooms need?",
  h1: "How much humidity and fresh air do mushrooms need?",
  eyebrow: "Grow problems",
  description: `Most culinary mushrooms fruit at ${fruitHumLo} to ${fruitHumHi}% humidity with regular fresh air. How to tell if you have too little or too much of either, and how to fix it.`,
  answer: `Most culinary mushrooms need ${pinHumLo} to ${pinHumHi}% humidity while pins form and ${fruitHumLo} to ${fruitHumHi}% while they fruit, plus regular fresh air to clear the carbon dioxide they breathe out. Too little humidity gives dry, cracked caps and stalled pins. Too little fresh air gives long stems and small caps. The two pull against each other, so the goal is steady humidity with gentle, regular air changes.`,
  sections: [
    {
      h2: "What humidity do mushrooms need at each stage?",
      html: `<p>Humidity is highest while pins form, then drops a little while mushrooms fruit so the caps do not stay wet. These are the numbers each profile uses.</p>
${table("Humidity and fresh air by species, from their profiles", ["Mushroom", "Pinning humidity", "Fruiting humidity", "Fruiting fan"], ["pearl-oyster", "blue-oyster", "pink-oyster", "lions-mane", "shiitake", "king-oyster", "chestnut", "nameko"].map(humidityRow))}
<p>During colonization the bag or block holds its own moisture, so room humidity matters less. Fresh air also matters less then, because mycelium grows well in the carbon dioxide it makes.</p>`,
    },
    {
      h2: "Why do mushrooms need fresh air?",
      html: `<p>Mushrooms breathe in oxygen and breathe out carbon dioxide, like we do. In a closed box carbon dioxide builds up fast. High carbon dioxide tells the mushroom it is still underground, so it stretches its stem to reach open air and keeps its cap small. Fresh air tells it that it has reached the surface and can open its cap.</p>
<p>Oysters are the most sensitive. ${link("pearl-oyster")} runs ${air("pearl-oyster", "fruiting")} while fruiting in its profile, while ${link("lions-mane")} runs ${air("lions-mane", "fruiting")}.</p>`,
    },
    {
      h2: "How do you know if humidity is too low?",
      html: `<ul>
<li>Pins form and then turn dry, yellow, or stop growing.</li>
<li>Caps crack, curl up at the edges, or look leathery.</li>
<li>The cut surface of the block looks pale and dry.</li>
<li>Lion's mane turns yellow or its spines stay short.</li>
</ul>
<p>Read <a href="/guides/dry-cracked-mushroom-caps">dry or cracked mushroom caps</a> for fixes.</p>`,
    },
    {
      h2: "How do you know if humidity is too high?",
      html: `<ul>
<li>Water pools on the caps or the block surface.</li>
<li>Caps get yellow or brown sticky spots, a sign of bacteria.</li>
<li>Mushrooms feel slimy instead of firm.</li>
</ul>
<p>The fix is usually more fresh air, not less humidity. Air moving across the surface lets water evaporate, which is what mushrooms need to pull moisture up through the block.</p>`,
    },
    {
      h2: "How do you know if fresh air is too low?",
      html: `<ul>
<li>Long, thin stems with small caps.</li>
<li>Oysters that look like coral or tubes instead of shelves.</li>
<li>Fuzzy white growth on the stems or caps.</li>
<li>A heavy, stale smell when you open the tent or chamber.</li>
</ul>
<p>Read <a href="/guides/leggy-mushroom-stems">long, leggy mushroom stems</a> for fixes.</p>`,
    },
    {
      h2: "How do you raise humidity without stale air?",
      html: `<ul>
<li><strong>Mist the walls, not the mushrooms.</strong> Two or three times a day in a tent or tub. Fine mist, no puddles.</li>
<li><strong>Use a humidity tent.</strong> A clear bag or tub over the block with a few holes holds moisture while air still moves.</li>
<li><strong>Add damp perlite</strong> to the bottom of a tub. It gives off moisture slowly.</li>
<li><strong>Use a humidifier on a timer or a chamber.</strong> A Shrooly chamber running OpenShrooly holds the profile's humidity and runs its fan on a schedule for each stage.</li>
</ul>`,
    },
    {
      h2: "How do you check your humidity reading?",
      html: `<p>Cheap hygrometers often read several percent off, and the error is often worst near the top of the range, where mushrooms live. To check one, seal it in a bag or jar with a small cap of table salt mixed with a few drops of water to a damp paste. After 8 to 12 hours at steady room temperature it should read 75%. Note how far off it is and correct your readings by that much.</p>`,
    },
  ],
  faq: [
    {
      q: "What humidity do oyster mushrooms need?",
      a: `${profile("pearl-oyster").name} pins at ${stage("pearl-oyster", "pinning").humidity_percent}% and fruits at ${fruit("pearl-oyster").humidity_percent}% humidity in its profile. Oysters also need more fresh air than most species.`,
    },
    {
      q: "Can mushrooms get too much humidity?",
      a: "Yes. Standing water on caps can cause bacterial spots and soft, slimy mushrooms. More fresh air usually fixes it faster than lowering humidity.",
    },
    {
      q: "How often should you fan mushrooms?",
      a: `In a tent or tub, fan two to four times a day, more often for oysters. A chamber runs its fan on a schedule. The oyster profiles here run the fan as often as every ${fruit("pearl-oyster").fan.period_min} minutes while fruiting. Slower species need less.`,
    },
    {
      q: "Do mushrooms need fresh air during colonization?",
      a: "Very little. Mycelium grows well in the carbon dioxide it makes. Fresh air becomes important when you want pins to form.",
    },
  ],
  related: [
    ["Mushrooms not pinning", "/guides/mushrooms-not-pinning"],
    ["Long, leggy mushroom stems", "/guides/leggy-mushroom-stems"],
    ["Dry or cracked mushroom caps", "/guides/dry-cracked-mushroom-caps"],
    ["Conditions for every species", "/grow"],
  ],
  updated: UPDATED,
};

const pinning = {
  slug: "mushrooms-not-pinning",
  title: "Mushrooms not pinning? Causes and fixes by stage",
  h1: "Why are my mushrooms not pinning?",
  eyebrow: "Grow problems",
  description: "Mushrooms usually fail to pin because the block is not fully colonized or nothing told it to fruit: no cooler air, fresh air, light, or humidity.",
  answer:
    "Mushrooms usually fail to pin for one of two reasons: the block is not fully colonized yet, or nothing has told it to fruit. Pins form when the block is fully white and then gets a change: cooler air, more fresh air, higher humidity, and light. Check those four, give it a week, and most blocks start to pin.",
  sections: [
    {
      h2: "Is the block fully colonized?",
      html: "<p>A block is ready when it is white all the way through, firm, and you cannot see much of the substrate. Patches of brown sawdust or straw mean the mycelium is still working. Starting fruiting early is the most common reason a block sits for weeks with no pins. Give it another week in warm, dark conditions.</p><p>Yellow or amber drops on the surface are normal. They are liquid the mycelium makes, and they often show up when it is close to done.</p>",
    },
    {
      h2: "Did the block get a fruiting trigger?",
      html: `<p>In the wild, mushrooms fruit when the weather turns: cooler nights, rain, and open air. At home you copy that. Most profiles drop the temperature a few degrees and raise humidity when pinning starts.</p>
${table("Colonization and pinning conditions, from their profiles", ["Mushroom", "Colonization", "Pinning", "Pinning humidity"], ["pearl-oyster", "blue-oyster", "lions-mane", "pink-oyster", "chestnut", "beech-shimeji"].map(dropRow))}
<p>${link("pink-oyster")} stays warm the whole way, with only a small drop. Cool-weather species such as ${link("blue-oyster")} pin best with a bigger drop.</p>`,
    },
    {
      h2: "Is there enough fresh air?",
      html: `<p>Pins need far more fresh air than colonization. A sealed bag or a closed tub can colonize well and then never pin because carbon dioxide stays high. Open the bag where the kit says, cut an X, or add holes, and fan a tent several times a day. In its pinning stage ${link("blue-oyster")} runs ${air("blue-oyster", "pinning")}. See <a href="/guides/humidity-and-fresh-air">humidity and fresh air for mushrooms</a>.</p>`,
    },
    {
      h2: "Is there enough light?",
      html: "<p>Most species need light to know where to fruit. About 12 hours a day of indirect daylight or room light is enough. A dark closet can stall pins. Enoki and button mushrooms are exceptions and fruit in the dark.</p>",
    },
    {
      h2: "Is humidity high enough at the surface?",
      html: `<p>If the cut opening dries out, pins cannot form there. Keep the surface damp but not wet. The profiles here pin at ${range("pinning", "humidity_percent")[0]} to ${range("pinning", "humidity_percent")[1]}% humidity.</p>`,
    },
    {
      h2: "Does your species need something special?",
      html: `<ul>
<li>${link("shiitake")} needs weeks of browning, then a cold shock. In its profile that is ${stage("shiitake", "browning").duration_days} days of browning and a ${stage("shiitake", "cold_shock").duration_days} day cold shock at ${temp(stage("shiitake", "cold_shock").temperature_c)} before it fruits.</li>
<li>${link("maitake")} and ${link("reishi")} are slow. Reishi often grows antlers before it forms a cap.</li>
<li>${link("button-cremini")} needs a casing layer on top of compost before it pins.</li>
</ul>`,
    },
    {
      h2: "What if it still will not pin?",
      html: "<p>If a fully white block has had a week of fruiting conditions with no pins, try a stronger trigger: a few days a bit cooler, or soak the block in cold water for a few hours, drain it, and put it back. Many growers find that wakes it up. If the block shrinks away from the bag, smells sour, or shows colored patches, it may be old or contaminated. Read <a href=\"/guides/mushroom-contamination\">mushroom contamination</a>.</p>",
    },
  ],
  faq: [
    {
      q: "How long does it take for mushrooms to pin?",
      a: `Usually a few days to two weeks after fruiting conditions start. In the profiles here pinning runs from ${range("pinning", "duration_days")[0]} days for the fastest species to about ${range("pinning", "duration_days")[1]} days for the slowest.`,
    },
    {
      q: "Do mushrooms need a cold shock to pin?",
      a: "Most do best with a drop of a few degrees, and shiitake needs a real cold shock. Warm species such as pink oyster pin without one.",
    },
    {
      q: "Should I open the bag before it is fully colonized?",
      a: "No. Opening early lets mold in and invites the block to fruit before it has the energy. Wait until it is white all the way through.",
    },
    {
      q: "Why are my pins forming inside the bag?",
      a: "Pins inside the bag mean the block is ready and is getting fresh air or light through the plastic. Open the bag at that spot so they can grow out.",
    },
  ],
  related: [
    ["Humidity and fresh air for mushrooms", "/guides/humidity-and-fresh-air"],
    ["Mushroom contamination", "/guides/mushroom-contamination"],
    ["How to grow mushrooms at home", "/guides/grow-mushrooms-at-home"],
    ["Conditions for every species", "/grow"],
  ],
  updated: UPDATED,
};

const leggy = {
  slug: "leggy-mushroom-stems",
  title: "Long, leggy mushroom stems and small caps: causes and fixes",
  h1: "Why do my mushrooms have long stems and small caps?",
  eyebrow: "Grow problems",
  description: "Long, thin mushroom stems with small caps almost always mean too much carbon dioxide from too little fresh air. Low light is the second cause. How to fix both.",
  answer:
    "Long, thin stems with small caps almost always mean too much carbon dioxide. The mushrooms are stretching to reach fresh air. Add more air changes, open more holes, or fan more often. If air is good, check light next: mushrooms in a dark corner also stretch toward the nearest light.",
  sections: [
    {
      h2: "What causes leggy mushrooms?",
      html: "<ul><li><strong>Too little fresh air.</strong> The most common cause by far. Carbon dioxide builds up around the block and the mushrooms grow stems instead of caps.</li><li><strong>Too little light.</strong> Mushrooms grow toward light. In a dark spot they stretch and the caps stay small and pale.</li><li><strong>Light from one side.</strong> Stems bend and stretch toward a window.</li><li><strong>Too warm.</strong> Some species, especially cool-weather oysters, grow thin and fast in a warm room.</li></ul>",
    },
    {
      h2: "How do you fix long stems?",
      html: `<ol>
<li>Add fresh air. Fan a tent four or more times a day, add holes, or prop the lid open a little. In a chamber, check that the fan runs and the profile matches the species.</li>
<li>Give 12 hours of indirect light a day, from above or in front of the opening.</li>
<li>Move the block somewhere a bit cooler if your species likes it cool. ${link("blue-oyster")} fruits at ${temp(fruit("blue-oyster").temperature_c)} in its profile.</li>
<li>Keep humidity up while you add air. Mist the walls more often if the extra air dries things out.</li>
</ol>
<p>The current flush may stay leggy, but it is still safe to eat. The next flush should look better.</p>`,
    },
    {
      h2: "Which mushrooms show it most?",
      html: `<p>Oysters show it fastest. ${link("pearl-oyster")}, ${link("blue-oyster")}, and ${link("golden-oyster")} all run their fans hardest in fruiting for this reason. In its profile Pearl Oyster runs ${air("pearl-oyster", "fruiting")}.</p>
<p>Some species are grown with long stems on purpose. Enoki is grown in the dark with high carbon dioxide to get its thin white stems, and king oyster growers sometimes keep air lower to grow a thick stem.</p>`,
    },
    {
      h2: "How do you set up the next flush so it does not stretch?",
      html: `<ul>
<li><strong>Open the right spot.</strong> Mushrooms grow out of the opening. Face it toward the light and toward open air, not into a corner.</li>
<li><strong>Do not crowd blocks.</strong> Several blocks in one small tent share the same air. Leave space, or add air changes for each block you add.</li>
<li><strong>Start fresh air before pins form.</strong> Leggy stems start early. Raise air changes when you start fruiting conditions, not when you first notice long stems.</li>
<li><strong>Match the profile to the species.</strong> In a chamber, an oyster on a lion's mane profile gets less air than it wants. ${link("pearl-oyster")} pins with ${air("pearl-oyster", "pinning")} in its profile.</li>
</ul>`,
    },
    {
      h2: "Is it fresh air or light?",
      html: "<ul><li>Stems long and caps small but normal color: fresh air.</li><li>Caps pale and stems bending toward one side: light.</li><li>Fuzzy white growth on the stems: fresh air. This fuzz is mycelium reaching for air, not mold.</li></ul>",
    },
  ],
  faq: [
    {
      q: "Are leggy mushrooms safe to eat?",
      a: "Yes, if they grew from a clean block and look and smell normal. Long stems change texture, not safety. Stems can be tougher, so slice them thin or use them for stock.",
    },
    {
      q: "Why are my oyster mushrooms shaped like coral?",
      a: "Coral-like or tube-shaped oysters are a classic sign of too much carbon dioxide. Add fresh air and the next flush should form normal shelves.",
    },
    {
      q: "Do leggy mushrooms mean the block is bad?",
      a: "No. It means the conditions around the block need changing. The same block can give a normal flush next time with more air and light.",
    },
    {
      q: "Can too much fresh air hurt mushrooms?",
      a: "Strong air blowing straight on the mushrooms dries them out and cracks caps. Aim for regular gentle air changes, not a constant breeze.",
    },
  ],
  related: [
    ["Humidity and fresh air for mushrooms", "/guides/humidity-and-fresh-air"],
    ["Dry or cracked mushroom caps", "/guides/dry-cracked-mushroom-caps"],
    ["Easiest mushrooms to grow at home", "/guides/easiest-mushrooms-to-grow"],
    ["Conditions for every species", "/grow"],
  ],
  updated: UPDATED,
};

const dry = {
  slug: "dry-cracked-mushroom-caps",
  title: "Dry, cracked, or curled mushroom caps: causes and fixes",
  h1: "Why are my mushroom caps dry or cracked?",
  eyebrow: "Grow problems",
  description: "Dry, cracked, or curled mushroom caps mean the air is too dry or air is blowing straight on them. How to raise humidity without stale air, species by species.",
  answer: `Dry, cracked, or curled caps mean the mushrooms are losing water faster than the block can supply it. Usually the air is drier than the species wants, or a fan, heater, or vent is blowing straight on them. Raise humidity, block direct airflow, and keep air changes gentle. Most culinary profiles here fruit at ${fruitHumLo} to ${fruitHumHi}% humidity.`,
  sections: [
    {
      h2: "What causes cracked caps?",
      html: "<ul><li><strong>Low humidity.</strong> Dry winter air and heated rooms are the usual cause.</li><li><strong>Direct airflow.</strong> A fan, heater, or air vent blowing on the block dries the caps even when the room humidity is fine.</li><li><strong>A dry block.</strong> After a flush or two, the block has less water to give. Soak it before the next flush.</li><li><strong>Too much light or heat from a lamp</strong> close to the mushrooms.</li></ul>",
    },
    {
      h2: "How do you fix dry caps?",
      html: `<ol>
<li>Put the block in a humidity tent or chamber if it is out in the room.</li>
<li>Mist the tent walls two or three times a day. Mist the air above the mushrooms, not the mushrooms themselves.</li>
<li>Move it away from heaters, fans, and vents.</li>
<li>Check your hygrometer. Read <a href="/guides/humidity-and-fresh-air">humidity and fresh air for mushrooms</a> for a simple salt test.</li>
<li>Soak a spent block in cold water for a few hours before the next flush.</li>
</ol>`,
    },
    {
      h2: "What humidity stops caps from cracking?",
      html: `<ul>
<li>${link("pearl-oyster")}: ${fruit("pearl-oyster").humidity_percent}% while fruiting.</li>
<li>${link("lions-mane")}: ${fruit("lions-mane").humidity_percent}% while fruiting.</li>
<li>${link("chestnut")}: ${fruit("chestnut").humidity_percent}% while fruiting.</li>
<li>${link("shiitake")}: ${fruit("shiitake").humidity_percent}% while fruiting.</li>
</ul>
<p>Every species page lists humidity for each stage.</p>`,
    },
    {
      h2: "Why do caps crack more in winter?",
      html: "<p>Cold outdoor air holds little water, and heating it indoors drops the humidity further. Many heated homes sit well below 40% humidity in winter, far below what fruiting mushrooms need. Air conditioning in summer dries the air too. A kit that fruited fine in spring can crack in January in the same spot. A tent or chamber keeps the air around the mushrooms humid no matter what the room does.</p>",
    },
    {
      h2: "How do you keep a kit on the counter from drying out?",
      html: `<ul>
<li>Cover it loosely with a clear plastic bag or a large clear bin with a few holes, so humidity stays in and some air gets through.</li>
<li>Set it on a tray of damp perlite or a damp towel inside the cover.</li>
<li>Keep it out of direct sun and away from the stove, the fridge vent, and heating vents.</li>
<li>Check the opening every morning. If it looks pale and dry, mist the cover and the air above.</li>
</ul>
<p>Once you have grown one kit, a chamber removes the daily misting. ${link("lions-mane")} and the oysters are good species to try in one.</p>`,
    },
    {
      h2: "Are cracked shiitake caps a problem?",
      html: `<p>Not always. Cracked caps on ${link("shiitake")} grown in dry, cool air are prized in parts of Asia and sold as flower shiitake. They are thick and dense. If you want smooth caps, raise humidity. If you like the look, they are safe to eat.</p>`,
    },
    {
      h2: "What about lion's mane turning yellow?",
      html: `<p>Yellow or brown patches on ${link("lions-mane")} usually mean dry air or a fruit that is past its best. Harvest yellowing lion's mane soon and raise humidity for the next one. It fruits at ${fruit("lions-mane").humidity_percent}% in its profile.</p>`,
    },
  ],
  faq: [
    {
      q: "Can you eat mushrooms with cracked caps?",
      a: "Yes. Cracks from dry air change the look and texture, not safety. Toss any mushroom that is slimy, smells off, or shows mold.",
    },
    {
      q: "Should I spray water directly on mushrooms?",
      a: "A light mist on young pins is fine, but water that sits on caps can cause bacterial spots. Mist the walls and the air above instead.",
    },
    {
      q: "Why are my oyster mushroom edges curling up?",
      a: "Edges that curl up and go wavy usually mean the mushrooms are past their best or the air is dry. Harvest oysters while the edges still curl down a little.",
    },
  ],
  related: [
    ["Humidity and fresh air for mushrooms", "/guides/humidity-and-fresh-air"],
    ["Long, leggy mushroom stems", "/guides/leggy-mushroom-stems"],
    ["How to grow mushrooms at home", "/guides/grow-mushrooms-at-home"],
    ["Conditions for every species", "/grow"],
  ],
  updated: UPDATED,
};

const contamination = {
  slug: "mushroom-contamination",
  title: "Mushroom contamination: mold, bacteria, and what to do",
  h1: "Is my mushroom block contaminated?",
  eyebrow: "Grow problems",
  description: "How to tell mushroom contamination from healthy mycelium: green, black, pink, and gray molds, wet bacterial spots, and what to do with a contaminated block.",
  answer:
    "Healthy mycelium is white, sometimes with yellow or amber drops. Contamination usually shows as color: green, blue-green, black, pink, or orange patches, or wet, slimy spots that smell sour. If you see colored mold, bag the block, take it outside without opening it, and clean the area. Do not eat mushrooms from a moldy block.",
  sections: [
    {
      h2: "Is it mold or mycelium?",
      html: "<ul><li><strong>Mycelium:</strong> white, cottony or rope-like, smells earthy or like fresh mushrooms.</li><li><strong>Yellow or amber drops:</strong> normal liquid from the mycelium. Not mold.</li><li><strong>Fuzzy white growth on stems:</strong> usually mycelium reaching for air. Add fresh air.</li><li><strong>Colored patches or powder:</strong> mold.</li><li><strong>Wet, sour, or slimy patches:</strong> bacteria.</li></ul>",
    },
    {
      h2: "What does each kind of contamination look like?",
      html: `<div class="table-wrap"><table class="conditions-table"><caption>Common contamination at home</caption><thead><tr><th scope="col">What you see</th><th scope="col">Likely cause</th><th scope="col">What to do</th></tr></thead><tbody>
<tr><th scope="row">Green or blue-green powdery patches</th><td>Green mold, often Trichoderma</td><td>Bag and remove the block</td></tr>
<tr><th scope="row">Black or dark gray fuzz</th><td>Black mold</td><td>Bag and remove the block</td></tr>
<tr><th scope="row">Pink or orange powder</th><td>Fast molds such as Neurospora</td><td>Bag and remove at once, it spreads fast</td></tr>
<tr><th scope="row">Gray, wispy growth that spreads in a day</th><td>Cobweb mold</td><td>Spot treat early or remove</td></tr>
<tr><th scope="row">Wet, slimy, sour-smelling patches</th><td>Bacteria</td><td>Remove the block</td></tr>
<tr><th scope="row">Yellow or brown sticky spots on caps</th><td>Bacterial blotch from standing water</td><td>Harvest, then add fresh air</td></tr>
</tbody></table></div>`,
    },
    {
      h2: "What should you do with a contaminated block?",
      html: "<ol><li>Do not open it indoors. Mold spores spread when you disturb it.</li><li>Put it in a trash bag, seal it, and take it outside.</li><li>Wipe the tent, tub, or chamber with soap and water, then 70% isopropyl alcohol, and let it dry.</li><li>Wash your hands and anything that touched the block.</li></ol><p>A block with green mold will not recover, and mushrooms from it are not worth the risk. Compost it outside, away from other grows, or throw it out.</p>",
    },
    {
      h2: "Can you save a block with cobweb mold?",
      html: "<p>Sometimes. Cobweb mold is gray and wispy and spreads very fast. Some growers spot treat small patches early with 3% hydrogen peroxide and more fresh air. If it comes back, remove the block.</p>",
    },
    {
      h2: "Why does contamination happen?",
      html: "<p>Mold spores and bacteria are everywhere, in the air, on hands, and on every surface. A healthy, fully colonized block usually wins because the mycelium has already claimed the food. Contamination wins when it gets in early or when the block is weak:</p><ul><li>The bag was opened or damaged before the mycelium finished.</li><li>The substrate was not sterilized or pasteurized well enough.</li><li>The block sat too warm, which helps green mold and bacteria.</li><li>The air was wet and stale for days.</li><li>The block is old and has given its best flushes.</li></ul>",
    },
    {
      h2: "What if mold shows up after a flush?",
      html: "<p>A block that has fruited two or three times has less food left and weaker defenses, so mold often shows up late. Small spots of green on a spent block mean it is done. Harvest anything clean that is already growing, then bag the block and remove it. Many growers put spent blocks in an outdoor compost pile or under wood chips, where they sometimes give one last flush on their own.</p>",
    },
    {
      h2: "How do you prevent contamination?",
      html: `<ul>
<li>Buy blocks and cultures from a supplier that sells clean, labeled products.</li>
<li>Do not open bags before they are fully colonized.</li>
<li>Clean your hands, tools, and chamber before each grow.</li>
<li>Keep fresh air flowing. Stale, wet air favors bacteria and mold.</li>
<li>Pick species that colonize fast. Oysters such as ${link("pearl-oyster")} outrun most molds.</li>
<li>Harvest on time and remove old mushrooms. Rotting fruit invites mold.</li>
</ul>`,
    },
  ],
  faq: [
    {
      q: "Can you eat mushrooms from a contaminated block?",
      a: "It is safest not to. Mold can spread into the mushrooms before you can see it. Grow a new block instead.",
    },
    {
      q: "Is green mold on mushrooms dangerous?",
      a: "Green mold mainly ruins the grow. Its spores can irritate lungs and allergies, so do not open or shake a moldy block indoors.",
    },
    {
      q: "Why is there yellow liquid on my mushroom block?",
      a: "Yellow or amber drops are normal. The mycelium makes them, especially when it is stressed or nearly done colonizing. They are not mold.",
    },
    {
      q: "Does contamination spread to other blocks?",
      a: "It can. Spores from an open moldy block drift to nearby blocks and surfaces. Remove it quickly and clean the area before the next grow.",
    },
    {
      q: "What is the white fuzz on my mushroom stems?",
      a: "Usually mycelium reaching for fresh air, not mold. It goes away when you add more air changes.",
    },
  ],
  related: [
    ["Mushrooms not pinning", "/guides/mushrooms-not-pinning"],
    ["Humidity and fresh air for mushrooms", "/guides/humidity-and-fresh-air"],
    ["Easiest mushrooms to grow at home", "/guides/easiest-mushrooms-to-grow"],
    ["Conditions for every species", "/grow"],
  ],
  updated: UPDATED,
};

export const PROBLEM_GUIDES = [humidity, pinning, leggy, dry, contamination];
