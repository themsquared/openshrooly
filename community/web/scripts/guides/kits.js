/** Kit and timing cluster: how long each mushroom takes, and what to do when a kit is not growing. */
import { FREE_IDS, air, days, fruit, link, profile, range, stage, temp } from "./data.js";

const UPDATED = "2026-10-27";
const UCANR = "https://ucanr.edu/sites/default/files/2012-05/144772.pdf";
const SARE = "https://projects.sare.org/media/pdf/F/u/n/FungiAlly_Oyster_booklet_Final-1.pdf";

const table = (caption, heads, rows) =>
  `<div class="table-wrap"><table class="conditions-table"><caption>${caption}</caption><thead><tr>${heads.map((h) => `<th scope="col">${h}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;

const sum = (id, ids) => profile(id).stages.filter((s) => ids.includes(s.id)).reduce((n, s) => n + Number(s.duration_days || 0), 0);
const colon = (id) => sum(id, ["colonization"]);
/** Days from a fully colonized kit. A shiitake kit that is not browned yet still has browning ahead. */
const fromKit = (id) => days(id) - colon(id);
const toPins = (id) => (id === "shiitake" ? sum(id, ["browning", "cold_shock"]) : sum(id, ["pinning"]));

const BY_TOTAL = [...FREE_IDS].sort((a, b) => days(a) - days(b) || profile(a).name.localeCompare(profile(b).name));
const fastest = BY_TOTAL[0];
const slowest = BY_TOTAL[BY_TOTAL.length - 1];
const OYSTERS = ["pink-oyster", "golden-oyster", "blue-oyster", "pearl-oyster"];
const [pinTempLo, pinTempHi] = range("pinning", "temperature_c");
const [fruitHumLo, fruitHumHi] = range("fruiting", "humidity_percent");
const [colLo, colHi] = range("colonization", "duration_days");
const [fruitLo, fruitHi] = range("fruiting", "duration_days");

function timeRow(id) {
  const pins = id === "shiitake" ? `${toPins(id)} (browning and cold shock)` : `${toPins(id)}`;
  return `<tr><th scope="row">${link(id)}</th><td>${colon(id)}</td><td>${pins}</td><td>${fruit(id).duration_days}</td><td>${days(id)}</td><td>${fromKit(id)}</td></tr>`;
}

const howLong = {
  slug: "how-long-to-grow-mushrooms",
  title: "How long does it take to grow mushrooms? Days for 20 species",
  h1: "How long does it take to grow mushrooms?",
  eyebrow: "Grow timing",
  description: `Mushrooms take ${days(fastest)} to ${days(slowest)} days from spawn to first harvest at home. Oysters are fastest. Days by stage for 20 species, and from a kit.`,
  answer: `Most culinary mushrooms take ${days(fastest)} to ${days(slowest)} days at home, from the start of colonization to the end of the first harvest. Oysters are fastest: ${profile(fastest).name.toLowerCase()} takes about ${days(fastest)} days and ${profile("pearl-oyster").name.toLowerCase()} about ${days("pearl-oyster")}. ${profile("shiitake").name} and ${profile("reishi").name.toLowerCase()} take ${days("shiitake")} to ${days("reishi")} days. From a fully colonized kit, most species fruit in one to three weeks.`,
  sections: [
    {
      h2: "How long does each mushroom take to grow?",
      html: `<p>These are the stage lengths in each free grow profile, in days, sorted from fastest to slowest. The total runs from the day you start colonization to the end of the first harvest window. The last column skips colonization, for a kit or block that arrives fully colonized.</p>
${table("Days per stage for each species, from their profiles", ["Mushroom", "Colonization", "To pins", "Fruiting", "Total", "From a colonized kit"], BY_TOTAL.map(timeRow))}
<p>Plug in your own start date with the <a href="/tools/grow-timeline">grow timeline calculator</a> to get calendar dates for every stage, and save them to your calendar.</p>`,
    },
    {
      h2: "What are the stages of growing mushrooms?",
      html: `<ol>
<li><strong>Colonization</strong> (${colLo} to ${colHi} days in the profiles). Mycelium spreads through the grain, sawdust, or straw. It is warm and dark, and nothing shows on the outside except white growth.</li>
<li><strong>Pinning</strong>. Cooler air, more fresh air, high humidity, and light tell the block to fruit. Tiny pins appear, usually where the bag is cut open.</li>
<li><strong>Fruiting</strong> (${fruitLo} to ${fruitHi} days). Pins grow into mushrooms ready to pick. Most clusters double in size every day or so near the end.</li>
</ol>
<p>${link("shiitake")} is the exception. After colonization it spends about ${stage("shiitake", "browning").duration_days} days forming a brown skin, then needs a cold shock before it pins. That is most of the reason it is one of the slowest.</p>`,
    },
    {
      h2: "How long does a mushroom grow kit take?",
      html: `<p>A store bought kit is usually fully colonized when it arrives, so you start at pinning. Pins usually show within a week or two of opening the kit in good conditions, and the first harvest comes a week or so after that. ${OYSTERS.map((id) => `${link(id)} takes about ${fromKit(id)} days`).join(", ")} from a colonized block in their profiles.</p>
<p>A pre browned ${link("shiitake")} block skips browning too. It starts at the cold shock, then fruits for about ${fruit("shiitake").duration_days} days.</p>
<p>If a kit has done nothing after two weeks open, go through <a href="/guides/mushroom-grow-kit-not-growing">grow kit not growing</a>.</p>`,
    },
    {
      h2: "How long after pinning can you harvest mushrooms?",
      html: `<p>From the first pins to the end of the first harvest is the fruiting stage, ${fruitLo} to ${fruitHi} days in the profiles. Fast oysters are usually ready to pick within a week of pinning. ${link("pink-oyster")} fruits for about ${fruit("pink-oyster").duration_days} days and ${link("pearl-oyster")} for about ${fruit("pearl-oyster").duration_days}. Slow species such as ${link("turkey-tail")} and ${link("reishi")} take five weeks or more.</p>
<p>Pick oysters when the cap edges are still curled under, just before they flatten. A grower guide from the University of California puts the oyster harvest point directly before the curled cap margins turn flat (<a href="${UCANR}">UC ANR</a>). Pick ${link("lions-mane")} when the spines are about a centimeter long and before it turns yellow.</p>`,
    },
    {
      h2: "What makes mushrooms grow faster or slower?",
      html: `<ul>
<li><strong>Temperature.</strong> Colonization slows a lot in a cool room. Most profiles colonize at about ${temp(stage("pearl-oyster", "colonization").temperature_c)}.</li>
<li><strong>Spawn rate.</strong> More spawn in the block means more starting points and faster colonization.</li>
<li><strong>Fresh air.</strong> Too little and pins stall or stretch. Oyster rooms are commonly run at 4 to 6 fresh air changes an hour while cropping (<a href="${UCANR}">UC ANR</a>). Check yours with the <a href="/tools/fresh-air-planner">fresh air planner</a>.</li>
<li><strong>Humidity.</strong> The profiles fruit at ${fruitHumLo} to ${fruitHumHi}% humidity. Dry air stalls pins.</li>
<li><strong>Strain.</strong> Two cultures of the same species can differ by a week or more.</li>
</ul>`,
    },
    {
      h2: "How long until the second flush?",
      html: `<p>After the first harvest, most blocks rest for one to two weeks before a second flush. Soaking the block in cold water for a few hours after the rest often helps it pin again. The second flush is usually smaller than the first, and most blocks give two or three before they run out of food. Oysters are the most reliable for repeat flushes.</p>`,
    },
  ],
  faq: [
    { q: "What is the fastest mushroom to grow at home?", a: `${profile(fastest).name}. Its profile runs about ${days(fastest)} days from the start of colonization to the end of the first harvest, and about ${fromKit(fastest)} days from a colonized kit.` },
    { q: "How long does it take to grow mushrooms from a kit?", a: "Most kits arrive fully colonized, so pins usually show within one to two weeks of opening, and the first harvest comes about a week after pins." },
    { q: "How long after pinning are mushrooms ready?", a: `Usually about a week for oysters. The fruiting stage runs ${fruitLo} to ${fruitHi} days across the profiles, longer for slow species such as reishi and turkey tail.` },
    { q: "Why does shiitake take so long?", a: `Shiitake colonizes for about ${colon("shiitake")} days, then needs about ${stage("shiitake", "browning").duration_days} days to form a brown skin and a cold shock before it fruits.` },
  ],
  related: [
    ["Grow timeline calculator", "/tools/grow-timeline"],
    ["Mushroom grow kit not growing", "/guides/mushroom-grow-kit-not-growing"],
    ["Why are my mushrooms not pinning?", "/guides/mushrooms-not-pinning"],
    ["Conditions for every species", "/grow"],
  ],
  updated: UPDATED,
};

const notGrowing = {
  slug: "mushroom-grow-kit-not-growing",
  title: "Mushroom grow kit not growing? A checklist by cause",
  h1: "Mushroom grow kit not growing? Check these causes",
  eyebrow: "Grow problems",
  description: "A kit that does nothing is usually not done colonizing, too warm or cold, too dry, short on fresh air, or not cut open. A checklist by cause.",
  answer: `Most grow kits that do nothing have one of five problems: the block is not fully colonized, the room is too warm or too cold, the air is too dry, there is too little fresh air, or the kit was not opened where it needs to be. Work through the checklist below in order. A healthy kit usually pins within one to two weeks once all five are right.`,
  sections: [
    {
      h2: "How long should a kit take before you worry?",
      html: `<p>Give a kit two weeks from the day you open it before you worry. Most kits arrive fully colonized and pin in one to two weeks. Slow species take longer: ${link("lions-mane")} pins in about ${toPins("lions-mane")} days in its profile, ${link("maitake")} in about ${toPins("maitake")}, and ${link("shiitake")} needs a cold shock first. See <a href="/guides/how-long-to-grow-mushrooms">how long mushrooms take to grow</a> for every species.</p>`,
    },
    {
      h2: "Is the block fully colonized?",
      html: `<p>A ready block is white all the way through and firm. Brown patches of sawdust mean the mycelium is still working. Keep it closed, warm, and out of direct sun for another week. Yellow or amber drops on the surface are normal and often show up when it is nearly done. A shiitake block should be brown on the outside before it fruits.</p>`,
    },
    {
      h2: "Is it too warm or too cold?",
      html: `<p>The profiles pin at ${temp(pinTempLo)} to ${temp(pinTempHi)}. Above about 24 °C (75 °F), most species other than ${link("pink-oyster")} slow down or stall, and warm, still air invites mold. Cold rooms slow everything. ${link("blue-oyster")} and ${link("enoki")} like it cool, ${link("pink-oyster")} and ${link("golden-oyster")} like it warm.</p>`,
    },
    {
      h2: "Is the air too dry?",
      html: `<p>Pins form on a damp surface. In a heated or air conditioned room the cut face of a kit dries out within hours. Mist the opening two or three times a day, never so much that water pools, or cover the kit with a loose plastic tent with holes. The profiles fruit at ${fruitHumLo} to ${fruitHumHi}% humidity. Dry, cracked, or yellow pins are the sign. See <a href="/guides/dry-cracked-mushroom-caps">dry or cracked mushroom caps</a>.</p>`,
    },
    {
      h2: "Is there enough fresh air?",
      html: `<p>A kit sealed in a bag, a cupboard, or a closed box builds up carbon dioxide, which tells the block to wait. Pins that do form grow long stems and tiny caps. Give the opening room air several times a day. In its fruiting stage ${link("pearl-oyster")} runs ${air("pearl-oyster", "fruiting")}. Commercial oyster growers aim for 4 to 6 fresh air changes an hour (<a href="${UCANR}">UC ANR</a>) and keep carbon dioxide under 800 ppm (<a href="${SARE}">SARE and FungiAlly</a>). Check a chamber with the <a href="/tools/fresh-air-planner">fresh air planner</a>, and read <a href="/guides/leggy-mushroom-stems">leggy mushroom stems</a>.</p>`,
    },
    {
      h2: "Is there enough light?",
      html: `<p>Most species need light to know which way to grow. Indirect daylight or room light for about 12 hours a day is enough. A dark closet can stall pins for weeks. Direct sun is too much and dries the block. ${link("enoki")} and ${link("button-cremini")} are the exceptions that fruit with little or no light.</p>`,
    },
    {
      h2: "Was the kit opened in the right place?",
      html: `<p>Pins grow where the block meets air. Most kits want an X or a slit cut in the side of the bag, about 5 cm (2 in) each way. A kit left closed can sit for weeks, or pin inside the plastic. If pins are forming inside the bag, cut it open right at that spot. Some kits need soaking in cold water first. Follow the instructions that came with it.</p>`,
    },
    {
      h2: "Is the kit old or contaminated?",
      html: `<p>Kits keep for a few weeks in the fridge, less on a warm shelf. An old kit shrinks away from the bag and may be slow to wake up. Green, blue, black, or pink patches, a slimy surface, or a sour smell mean contamination. Do not eat from a moldy kit. Read <a href="/guides/mushroom-contamination">mushroom contamination</a> to tell mold from healthy mycelium.</p>`,
    },
    {
      h2: "Why did my kit stop growing after the first harvest?",
      html: `<p>That is normal. A block needs one to two weeks of rest after a flush to build up for the next one. After the rest, soak it in cold water for a few hours to replace the water the first flush used, drain it, and set it back up in fruiting conditions. Expect a smaller second flush. Most kits give two or three flushes before they run out of food. When a block stops pinning after that, break it up into garden soil or compost.</p>`,
    },
    {
      h2: "When should you give up on a kit?",
      html: `<p>If a fully white kit has had two to three weeks of the right temperature, damp air, fresh air, and light, and a cold soak, with no pins, it is probably spent or the culture is weak. Contact the seller, since many replace kits that never fruit. If it is contaminated, bag it and throw it out away from your other blocks.</p>
<p>Still stuck? See <a href="/guides/mushrooms-not-pinning">why mushrooms are not pinning</a> for more on fruiting triggers, or find your species in the <a href="/grow">conditions for every species</a>.</p>`,
    },
  ],
  faq: [
    { q: "Why is my mushroom grow kit not growing?", a: "Usually the block is not fully colonized, the room is too warm or cold, the opening is too dry, there is too little fresh air, or the kit was not cut open where it needs to be." },
    { q: "How long should I wait for a mushroom kit to grow?", a: "About two weeks after opening. Most kits pin in one to two weeks. Slow species such as lion's mane, maitake, and shiitake can take longer." },
    { q: "Why did my mushroom kit stop growing?", a: "After a harvest a block rests for one to two weeks. Soak it in cold water for a few hours after the rest and it usually pins again, with a smaller flush." },
    { q: "Can a mushroom kit grow again?", a: "Yes. Most kits give two or three flushes with a rest and a cold soak between them, each smaller than the last." },
  ],
  related: [
    ["Why are my mushrooms not pinning?", "/guides/mushrooms-not-pinning"],
    ["How long does it take to grow mushrooms?", "/guides/how-long-to-grow-mushrooms"],
    ["Mushroom contamination", "/guides/mushroom-contamination"],
    ["Fresh air and humidity planner", "/tools/fresh-air-planner"],
  ],
  updated: UPDATED,
};

export const KIT_GUIDES = [howLong, notGrowing];
