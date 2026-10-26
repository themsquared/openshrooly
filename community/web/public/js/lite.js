/** Small script for static guide and profile pages: mobile menu plus a sign-in or account link. app.js is not needed here. */
import { bindMobileNav } from "./chrome.js";
import { isSignedIn } from "./api.js";

bindMobileNav();
const nav = document.getElementById("session-nav");
if (nav) {
  nav.innerHTML = isSignedIn()
    ? '<a href="/account">Account</a>'
    : '<a class="nav-signin button" href="/login">Sign in</a>';
}
