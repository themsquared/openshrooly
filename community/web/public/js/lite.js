/** Small script for static guide and profile pages: mobile menu plus a sign-in or account link. app.js is not needed here. */
import { bindMobileNav, setCoachNav } from "./chrome.js";
import { api, isSignedIn } from "./api.js";

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
