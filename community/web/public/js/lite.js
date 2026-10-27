/** Small script for static guide and profile pages: mobile menu plus a sign-in or account link. app.js is not needed here. */
import { bindMobileNav, setCoachNav } from "./chrome.js";
import { api, isSignedIn } from "./api.js";
import { bindShareButtons, shareButtonHtml, shareUrl, signupCtaHtml } from "./share.js";

bindMobileNav();
const nav = document.getElementById("session-nav");
if (nav) {
  nav.innerHTML = isSignedIn()
    ? '<a href="/account">Account</a>'
    : '<a class="nav-signin button" href="/login">Sign in</a>';
}

// Grow Coach link: only for signed-in users the API allows, never on Off-menu pages.
if (isSignedIn() && !document.body.hasAttribute("data-coach-off")) {
  api("/api/me")
    .then((me) => setCoachNav(Boolean(me?.grow_coach?.available)))
    .catch(() => {});
}

// Culinary profile pages: a share button, and a sign-up card for visitors who are not signed in. Off-menu pages stay as they are.
const body = document.body;
if (body.dataset.page === "profiles" && !body.hasAttribute("data-coach-off")) {
  const slug = location.pathname.replace(/^\/profiles\//, "").replace(/\.html$/, "").replace(/\/$/, "");
  const actions = document.querySelector(".profile-page .actions");
  if (slug && actions) {
    const name = document.querySelector(".profile-page h1")?.textContent?.trim() || "";
    actions.insertAdjacentHTML("beforeend", shareButtonHtml({ url: shareUrl(location.pathname), title: name, type: "profile", itemId: slug }));
    bindShareButtons();
    if (!isSignedIn()) actions.insertAdjacentHTML("afterend", signupCtaHtml({ next: `/profile?id=${encodeURIComponent(slug)}`, where: "profile_page" }));
  }
}

// /contact?topic=install picks that topic, so people stuck at install can write in without an account.
const topic = document.querySelector('form[name="contact"] select[name="topic"]');
const wanted = new URLSearchParams(location.search).get("topic");
if (topic && wanted && [...topic.options].some((o) => o.value === wanted)) topic.value = wanted;
