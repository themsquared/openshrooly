/**
 * Pages for Shrooly owners: what happened to the company, how to reuse the
 * hardware, and a FAQ built from what owners actually search for.
 *
 * Rules for this file (checked by api/test/owners.test.js):
 * - Every fact about the Shrooly company links a public source in `sources`.
 *   Where a fact cannot be confirmed, the copy says so. No guesses about money or motives.
 * - "Shrooly" names only the hardware and the company that made it. Our product is Shroom Labs.
 * - Each section h2 is a question an owner types, and its first sentence answers it.
 *   Those sections become the page's FAQPage markup, word for word.
 */

export const OWNERS_UPDATED = "2026-10-26";
export const CHECKED = "October 26, 2026";

const a = (href, text) => `<a href="${href}" rel="noopener">${text}</a>`;
const OPEN = a("https://openshrooly.com/", "OpenShrooly");
const GRAHAM = a("https://github.com/grahamsz/openshrooly", "Graham Stewart (grahamsz)");
const RECOVERY = a("https://github.com/themsquared/openshrooly/blob/cursor/community-platform-fa9c/docs/RECOVERY.md", "USB recovery guide");
const REDDIT = a("https://www.reddit.com/r/shrooly/", "r/shrooly");

export const SOURCES = {
  openshrooly: { label: "OpenShrooly.com, project page by Graham Stewart", url: "https://openshrooly.com/" },
  openshroolyRepo: { label: "grahamsz/openshrooly on GitHub", url: "https://github.com/grahamsz/openshrooly" },
  july2025: { label: "Shrooly customer update, July 31, 2025 (the latest posted)", url: "https://shrooly.com/blogs/customer-updates/july-update-2025" },
  updates: { label: "Shrooly customer updates index", url: "https://shrooly.com/blogs/customer-updates" },
  connection: { label: "Shrooly support article: Connection issues", url: "https://support.shrooly.com/en/articles/9675290-connection-issues" },
  status: { label: "status.shrooly.com", url: "https://status.shrooly.com/" },
  store: { label: "shrooly.com store", url: "https://shrooly.com/" },
  kickstarter: { label: "Shrooly on Kickstarter", url: "https://www.kickstarter.com/projects/shrooly/shrooly-grow-rare-and-healthy-mushrooms-with-zero-effort" },
  indiegogo: { label: "Shrooly on Indiegogo", url: "https://www.indiegogo.com/projects/shrooly-grow-mushrooms-you-can-t-find-anywhere" },
  play: { label: "Shrooly app on Google Play and its reviews", url: "https://play.google.com/store/apps/details?id=com.bitraptors.shrooly.prod" },
  outOfBusiness: { label: "r/shrooly: Out of business? (August 19, 2025)", url: "https://www.reddit.com/r/shrooly/comments/1mupwan/out_of_business/" },
  euSite: { label: "r/shrooly: EU/UK website gone (August 20, 2025)", url: "https://www.reddit.com/r/shrooly/comments/1mvq1la/" },
  noSupport: { label: "r/shrooly: No customer service (2025)", url: "https://www.reddit.com/r/shrooly/comments/1m8e5k0/" },
  supportEmail: { label: "r/shrooly: Got an email from support (2025)", url: "https://www.reddit.com/r/shrooly/comments/1nj2dgv/" },
  classAction: { label: "r/shrooly: Class Action lawsuit (September 2025)", url: "https://www.reddit.com/r/shrooly/comments/1n5whkl/" },
  workable: { label: "r/shrooly: Workable OpenShrooly release! (August 30, 2025)", url: "https://www.reddit.com/r/shrooly/comments/1n4d9ib/" },
  open10: { label: "r/shrooly: OpenShrooly 1.0 (July 28, 2026)", url: "https://www.reddit.com/r/shrooly/comments/1v8lh50/openshrooly_10/" },
};

const cite = (key) => a(SOURCES[key].url, SOURCES[key].label.split(" (")[0]);

/** Each section: { h2, answer, html? }. A question h2 with an answer goes into FAQPage. */
const whatHappened = {
  slug: "what-happened-to-shrooly",
  title: "What happened to Shrooly? The app, the store, and support",
  h1: "What happened to Shrooly?",
  eyebrow: "For Shrooly owners",
  updated: OWNERS_UPDATED,
  description: "Shrooly app not working and support not answering? What we can confirm about the Shrooly company, app, and store, with sources, and how to keep your chamber.",
  answer:
    "We could not find a public shutdown notice from the company that made Shrooly. Its last customer update was July 31, 2025. Since August 2025 many owners report the app will not sign in, support does not answer, and orders did not arrive. Your chamber can still run on free community software.",
  sections: [
    {
      h2: "Is Shrooly out of business?",
      answer: "It is unclear, because the company has not said so in public and its website and status page still load.",
      html: `<p>Here is what we can see as of ${CHECKED}. The ${cite("store")} still loads and lists products as available. ${cite("status")} says all services are online. We could not confirm that new orders ship.</p>
      <p>At the same time, the last post on the ${cite("updates")} page is from July 31, 2025. In August 2025 owners on ${REDDIT} began asking if the company was ${cite("outOfBusiness")}. The ${cite("openshrooly")} project page says that it appears, as of September 2025, that the company has gone out of business. We found no bankruptcy notice or public statement either way.</p>`,
    },
    {
      h2: "What can we confirm, and when?",
      answer: "These are the dated facts we could check against a public page.",
      faq: false,
      html: `<ul>
        <li><strong>June 2022.</strong> Shrooly runs a crowdfunding campaign on ${cite("indiegogo")}.</li>
        <li><strong>September 23 to November 13, 2022.</strong> ${cite("kickstarter")}: 144 backers pledged $63,240.</li>
        <li><strong>December 2023 to July 2025.</strong> Regular ${cite("updates")} report on manufacturing, then shipping to backers in Europe, the US, and Canada.</li>
        <li><strong>July 31, 2025.</strong> The ${cite("july2025")} says European crowdfunding shipments are done, US and Canada orders are shipping, and new chamber software is in testing. It is the last update posted.</li>
        <li><strong>August 2025.</strong> Owners report the app shows a no internet connection error at sign in (${cite("euSite")}) and ask if the company closed.</li>
        <li><strong>August 30, 2025.</strong> Graham Stewart posts the first ${cite("workable")}, free replacement software for the chamber.</li>
        <li><strong>Late 2025.</strong> Owners report that support emails go unanswered or bounce (${cite("noSupport")}, ${cite("supportEmail")}).</li>
        <li><strong>July 28, 2026.</strong> ${cite("open10")} is released.</li>
        <li><strong>${CHECKED}.</strong> shrooly.com and status.shrooly.com still load. Whether orders are filled is unclear.</li>
      </ul>`,
    },
    {
      h2: "Why did my Shrooly app stop working?",
      answer: "Many owners see a no internet connection error when they sign in to the Shrooly app, even on working Wi-Fi, and we do not know the cause.",
      html: `<p>Reports of this started in August 2025 (${cite("euSite")}) and continue in ${cite("play")}. Shrooly's own ${cite("connection")} article says the chamber needs internet and Bluetooth to start a new cultivation. So if the app cannot sign in, a new guided grow cannot start.</p>`,
    },
    {
      h2: "What still works on a stock Shrooly?",
      answer: "Owners report that manual programs on the chamber still run, but app guided grows cannot start without the app.",
      html: `<p>That comes from owner reports in ${cite("play")} and on ${REDDIT}. We have not tested a stock chamber ourselves, so treat it as unconfirmed. The hardware itself, the humidifier, fan, lights, and sensors, does not depend on the app.</p>`,
    },
    {
      h2: "Can I get a refund from Shrooly?",
      answer: "We do not know of a working way to get a refund from Shrooly right now.",
      html: `<p>Owners report that support emails stopped working in 2025 (${cite("supportEmail")}). If you paid by card or PayPal, your card issuer or PayPal is the place to ask about a dispute. Crowdfunding backers can message the creator through ${cite("kickstarter")} or ${cite("indiegogo")}. Owners discussed a ${cite("classAction")} on Reddit in September 2025. We could not confirm that any case was filed.</p>`,
    },
    {
      h2: "Is my Shrooly hardware still worth keeping?",
      answer: "Yes. The chamber is a sensor driven grow box with a humidifier, fan, and lights, and free software can run it with no Shrooly app.",
      html: `<p>${OPEN}, by ${GRAHAM}, replaces the stock software so the chamber runs on your Wi-Fi with its own web page. Shroom Labs builds on it with stage by stage grow profiles and an optional phone dashboard. See <a href="/reuse-your-shrooly">how to reuse your Shrooly</a>.</p>`,
    },
    {
      h2: "Who wrote this page?",
      answer: "Shroom Labs wrote it. We are not made by or affiliated with the company behind Shrooly.",
      faq: false,
      html: `<p>We build free tools for Shrooly owners on top of ${OPEN}. We only state what a public page shows, and we say unclear when we cannot confirm something. If anything here is wrong or out of date, <a href="/account/feedback">tell us</a> and we will fix it.</p>`,
    },
  ],
  sources: ["store", "status", "updates", "july2025", "connection", "kickstarter", "indiegogo", "play", "outOfBusiness", "euSite", "noSupport", "supportEmail", "classAction", "openshrooly", "workable", "open10"],
  related: [
    ["Reuse your Shrooly", "/reuse-your-shrooly"],
    ["Shrooly FAQ", "/shrooly-faq"],
    ["Shrooly app not working? Keep using your chamber", "/guides/shrooly-app-not-working"],
  ],
};

const reuse = {
  slug: "reuse-your-shrooly",
  title: "Reuse your Shrooly: free firmware, grow profiles, phone control",
  h1: "Reuse your Shrooly",
  eyebrow: "For Shrooly owners",
  updated: OWNERS_UPDATED,
  description: "Your Shrooly still works. Install free OpenShrooly firmware from Chrome or Edge, grow with stage by stage profiles, and check it from your phone.",
  answer:
    "Yes, you can reuse your Shrooly. Free, open source software called OpenShrooly replaces the stock software, so the chamber runs on your own Wi-Fi with no Shrooly app. You install it from Chrome or Edge with a USB-C cable in about 5 minutes. Shroom Labs adds grow profiles and an optional phone dashboard.",
  sections: [
    {
      h2: "What do I need to reuse my Shrooly?",
      answer: "A computer with Chrome or Edge, a USB-C data cable, your Shrooly, and about 5 minutes.",
      html: `<p>Some USB-C cables only carry power, so if the chamber does not show up, try another cable. You do not need an account to install, and you do not need the Shrooly app at all.</p>`,
    },
    {
      h2: "How do I install it?",
      answer: "Open the install page on a computer, plug in the chamber, and press Install.",
      html: `<ol>
        <li>Write down your current humidity and temperature settings.</li>
        <li>Plug your Shrooly into the computer with the USB-C cable.</li>
        <li>Open <a href="/install">the install page</a>, press Install, and pick your Shrooly from the list.</li>
        <li>Enter your Wi-Fi details when it finishes. That is it.</li>
      </ol>
      <p>If the screen does not change after installing, unplug both the USB and power cables, wait 10 seconds, and plug in power only.</p>`,
    },
    {
      h2: "Should I back up my Shrooly first?",
      answer: "Yes, if you might ever want the original software back, save a backup before you install.",
      html: `<p>The browser installer does not save the original for you. The ${RECOVERY} shows how to save a full copy with a free command line tool. It takes about 10 minutes and is the only way to restore the stock software later. If you are sure you will not go back, you can skip it.</p>`,
    },
    {
      h2: "Can I go back to the original Shrooly software?",
      answer: "Yes, if you saved a backup first, you can write it back over USB.",
      html: `<p>USB is always the way back. Even if an update goes wrong, the chip can be reached over the cable and set up again, and installing twice does no harm. Without a backup you can still reinstall OpenShrooly at any time, but the stock software cannot be restored.</p>`,
    },
    {
      h2: "What do I get?",
      answer: "Your chamber back, on your own Wi-Fi, with free grow profiles and an optional dashboard on your phone.",
      html: `<ul>
        <li><strong>Local control.</strong> The chamber's own web page sets temperature, humidity, fresh air, and light. It also works with Home Assistant. No cloud needed.</li>
        <li><strong>Grow profiles.</strong> <a href="/grow">Stage by stage conditions</a> for oyster, lion's mane, shiitake, and more.</li>
        <li><strong>Your chamber on your phone.</strong> Link it to a free account to see live readings from anywhere, get email alerts, change the profile and stage, and set fresh air and light.</li>
        <li><strong>Link this device.</strong> Press button 4 on the chamber, choose Link this device, and scan the QR code. This came in release 1.0.6-sl.1.</li>
        <li><strong>Safe updates.</strong> New versions install over Wi-Fi, only if they are signed by Shroom Labs, and the chamber keeps its current version if anything looks wrong.</li>
      </ul>`,
    },
    {
      h2: "What does it cost?",
      answer: "Installing is free, the software is free and open source, and most grow profiles are free.",
      html: `<p>OpenShrooly is MIT licensed. Linking a chamber to an account is optional and free during the open beta. A few specialty profiles are paid, such as <a href="/profiles/king-oyster-thick-stem">King Oyster: thick-stem method</a> at $2.99. You never need to buy anything to grow.</p>`,
    },
    {
      h2: "Is it safe to flash my Shrooly?",
      answer: "Many owners have installed it without trouble, but it is beta software, so use it at your own risk.",
      html: `<p>The ${OPEN} project says many users have installed it successfully, and that it is experimental. Our installer only offers releases signed by Shroom Labs, and your browser checks the signature before anything is sent to the chamber. If something goes wrong, the USB cable gets you back.</p>`,
    },
    {
      h2: "Who made the software?",
      answer: "OpenShrooly was created by Graham Stewart, and Shroom Labs builds on his work.",
      html: `<p>See ${GRAHAM} and ${OPEN}. Shroom Labs adds grow profiles, the install page, and the optional account. We are not made by or affiliated with the company behind Shrooly. Community help lives on ${REDDIT}.</p>`,
    },
  ],
  sources: ["openshrooly", "openshroolyRepo", "workable", "open10", "connection"],
  related: [
    ["What happened to Shrooly?", "/what-happened-to-shrooly"],
    ["Shrooly FAQ", "/shrooly-faq"],
    ["Compare growing conditions for every species", "/grow"],
  ],
};

const faq = {
  slug: "shrooly-faq",
  title: "Shrooly FAQ: app not working, offline, refunds, firmware",
  h1: "Shrooly FAQ",
  eyebrow: "For Shrooly owners",
  updated: OWNERS_UPDATED,
  description: "Straight answers for Shrooly owners: app not working, no internet connection, is Shrooly out of business, refunds, bricked units, and free firmware.",
  answer:
    "Short version: many Shrooly owners lost the app in 2025, and the company has not said why. The chamber itself still works. Free OpenShrooly firmware runs it on your own Wi-Fi with no Shrooly app, and you can install it from Chrome or Edge in about 5 minutes. Answers to the questions owners ask most are below.",
  sections: [
    {
      h2: "Why is my Shrooly app not working?",
      answer: "Since August 2025 many owners cannot sign in to the Shrooly app, and the company has not explained why.",
      html: `<p>The usual symptom is a no internet connection error on a working network (${cite("euSite")}, ${cite("play")}). Your chamber is not broken. See <a href="/guides/shrooly-app-not-working">how to keep using your chamber</a>.</p>`,
    },
    {
      h2: "What does no internet connection mean in the Shrooly app?",
      answer: "Owners see it even when their Wi-Fi works fine, so it points to the app's sign in service rather than your network.",
      html: `<p>We cannot see why the sign in fails. Your chamber does not need that service if you move it to OpenShrooly.</p>`,
    },
    {
      h2: "Is the Shrooly server down?",
      answer: "The company's status page says all services are online, but owners still report that the app cannot sign in.",
      html: `<p>${cite("status")} showed all services online when we checked on ${CHECKED}. We cannot see inside their servers, so we cannot say why the app fails.</p>`,
    },
    {
      h2: "Is Shrooly out of business?",
      answer: "It is unclear, because there is no public statement and shrooly.com still loads.",
      html: `<p>The last customer update was July 31, 2025, and owners report no support since. The full picture, with sources, is on <a href="/what-happened-to-shrooly">what happened to Shrooly</a>.</p>`,
    },
    {
      h2: "Is Shrooly bankrupt?",
      answer: "We found no public bankruptcy notice for Shrooly.",
      html: `<p>That does not mean the company is running normally. It means we cannot confirm it either way.</p>`,
    },
    {
      h2: "Can I still use my Shrooly?",
      answer: "Yes. Owners report manual programs still run on a stock chamber, and free OpenShrooly firmware gives you full control again.",
      html: `<p>With OpenShrooly the chamber runs on your Wi-Fi with its own web page, and Shroom Labs adds <a href="/grow">grow profiles</a>. See <a href="/reuse-your-shrooly">reuse your Shrooly</a>.</p>`,
    },
    {
      h2: "Can I use my Shrooly offline?",
      answer: "Yes, on OpenShrooly the chamber runs on your home Wi-Fi with no internet and no Shrooly app.",
      html: `<p>Its own web page and its buttons keep working if your internet goes down. A Shroom Labs account is optional.</p>`,
    },
    {
      h2: "Is my Shrooly bricked?",
      answer: "Almost certainly not. The hardware still works, and only the app side stopped for most owners.",
      html: `<p>If the chamber powers on, it can take new software over the USB cable. If an install goes wrong, you can run it again over the same cable.</p>`,
    },
    {
      h2: "Is there a replacement for the Shrooly app?",
      answer: "Yes. OpenShrooly gives the chamber its own web page on your Wi-Fi, and Shroom Labs adds a phone dashboard if you want one.",
      html: `<p>The web page works from any phone or computer on your home network. Linking to a free Shroom Labs account adds live readings from anywhere and email alerts.</p>`,
    },
    {
      h2: "Is there custom Shrooly firmware?",
      answer: "Yes. OpenShrooly is free, open source replacement firmware for the Shrooly, created by Graham Stewart.",
      html: `<p>See ${OPEN}. The Shroom Labs release, 1.0.6-sl.1, adds grow profiles and the Link this device menu.</p>`,
    },
    {
      h2: "How do I flash my Shrooly?",
      answer: "Plug it into a computer with a USB-C data cable, open the install page in Chrome or Edge, and press Install.",
      html: `<p>It takes about 5 minutes. <a href="/install">Open the installer</a>. Back up first if you might want the stock software back.</p>`,
    },
    {
      h2: "Can I go back to the original Shrooly firmware?",
      answer: "Only if you save a backup before you install.",
      html: `<p>The ${RECOVERY} shows how to save and restore it over USB.</p>`,
    },
    {
      h2: "How do I get a Shrooly refund?",
      answer: "We do not know of a working way to get one from the company right now.",
      html: `<p>If you paid by card or PayPal, ask your card issuer or PayPal about a dispute. Backers can message the creator on ${cite("kickstarter")} or ${cite("indiegogo")}.</p>`,
    },
    {
      h2: "How do I contact Shrooly customer service?",
      answer: "Owners report that Shrooly support emails stopped getting answers in 2025, and some now bounce.",
      html: `<p>See ${cite("noSupport")} and ${cite("supportEmail")}. Shroom Labs is not Shrooly support, but owners help each other on ${REDDIT}.</p>`,
    },
    {
      h2: "Is there a Shrooly class action lawsuit?",
      answer: "Owners discussed one on Reddit in September 2025, but we could not confirm that any case was filed.",
      html: `<p>See the ${cite("classAction")} thread.</p>`,
    },
    {
      h2: "Can I use my Shrooly without Shrooly pods?",
      answer: "Yes. OpenShrooly runs the chamber by temperature, humidity, fresh air, and light, so you can fruit your own blocks if they fit.",
      html: `<p>Pick a species on <a href="/grow">the conditions table</a> and follow its stages.</p>`,
    },
    {
      h2: "Should I buy a Shrooly now?",
      answer: "Be careful. Owners report orders that never arrived, and we cannot confirm that new orders ship.",
      html: `<p>If you already own one, it is worth reusing.</p>`,
    },
    {
      h2: "Is Shroom Labs part of Shrooly?",
      answer: "No. Shroom Labs is not made by or affiliated with the company behind Shrooly.",
      html: `<p>We build free tools for owners on top of ${OPEN}.</p>`,
    },
  ],
  sources: ["status", "updates", "july2025", "connection", "kickstarter", "indiegogo", "play", "euSite", "noSupport", "supportEmail", "classAction", "openshrooly"],
  related: [
    ["What happened to Shrooly?", "/what-happened-to-shrooly"],
    ["Reuse your Shrooly", "/reuse-your-shrooly"],
    ["Mushroom growing FAQ", "/faq"],
  ],
};

export const OWNER_PAGES = [whatHappened, reuse, faq];

/** The searches these pages answer. Each one maps to a question h2 above. */
export const TARGET_QUERIES = [
  "shrooly app not working",
  "shrooly no internet connection",
  "shrooly server down",
  "shrooly offline",
  "shrooly out of business",
  "is shrooly out of business",
  "is shrooly still in business",
  "is shrooly bankrupt",
  "can I still use my shrooly",
  "shrooly bricked",
  "shrooly replacement app",
  "shrooly firmware",
  "flash shrooly",
  "shrooly refund",
  "shrooly customer service",
  "shrooly support",
  "shrooly class action lawsuit",
  "is shrooly worth it",
  "what happened to shrooly",
];
