import { test } from "node:test";
import assert from "node:assert/strict";
import { renderSignInEmail, FOOTER_LINE } from "../src/email-layout.js";
import { sendEmail } from "../src/email.js";
import { call, testEnv } from "./helpers.js";

// Same rule as the alert emails: no dash of any kind, hyphens included, in words we write.
const DASHES = /[\u2010-\u2015\u2212-]/;
const LINK = "https://shroomlabs.io/auth/callback.html?token=abc123&x=<y>";
const visible = (html) => html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/https?:\/\/\S+/g, "");

test("sign in email: branded HTML with a button, a fallback link, the expiry, the footer and no dashes", () => {
  const m = renderSignInEmail(LINK, 15);
  assert.equal(m.subject, "Your Shroom Labs sign in link");
  assert.doesNotMatch(m.subject, DASHES);
  assert.match(m.html, /name="viewport"/);
  assert.match(m.html, />Shroom Labs</);
  const escaped = "https://shroomlabs.io/auth/callback.html?token=abc123&amp;x=&lt;y&gt;";
  assert.equal(m.html.split(`href="${escaped}"`).length - 1, 2, "button and fallback both carry the escaped link");
  assert.ok(!m.html.includes("<y>"), "the link is escaped");
  assert.match(m.html, />Sign in</);
  assert.match(m.html, /copy this link into your browser/);
  assert.match(m.html, /expires in 15\u00a0minutes/);
  assert.match(m.text, /expires in 15\u00a0minutes/);
  assert.ok(m.text.includes(LINK));
  for (const part of [m.html, m.text]) assert.ok(part.includes(FOOTER_LINE));
  assert.doesNotMatch(visible(m.html), DASHES);
  assert.doesNotMatch(m.text.replace(/https?:\/\/\S+/g, ""), DASHES);
});

test("Resend gets both the HTML and the text part, from the default sender", async (t) => {
  const sent = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    sent.push({ url, body: JSON.parse(init.body), auth: init.headers.authorization });
    return new Response("{}", { status: 200 });
  });
  const m = renderSignInEmail(LINK, 15);
  const res = await sendEmail({ RESEND_API_KEY: "re_test_only" }, { to: "a@example.com", ...m });
  assert.equal(res.ok, true);
  assert.equal(sent[0].url, "https://api.resend.com/emails");
  assert.equal(sent[0].body.from, "Shroom Labs <noreply@shroomlabs.io>");
  assert.equal(sent[0].body.html, m.html);
  assert.equal(sent[0].body.text, m.text);
  await sendEmail({ RESEND_API_KEY: "re_test_only" }, { to: "a@example.com", subject: "s", text: "plain" });
  assert.equal("html" in sent[1].body, false, "a text only message is not sent as HTML");
});

test("magic link start sends the HTML sign in email through Resend", async (t) => {
  const sent = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    if (String(url).includes("turnstile")) return Response.json({ success: true });
    sent.push(JSON.parse(init.body));
    return new Response("{}", { status: 200 });
  });
  const ctx = testEnv({ RESEND_API_KEY: "re_test_only", TURNSTILE_SECRET_KEY: "ts_test_only" });
  const res = await call(ctx, "POST", "/api/auth/magic/start", { body: { email: "html@example.com", turnstile: "tok" } });
  assert.equal(res.status, 200);
  assert.equal(res.data.debug_token, undefined, "a real send never returns the token");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to[0], "html@example.com");
  assert.equal(sent[0].subject, "Your Shroom Labs sign in link");
  assert.match(sent[0].html, /href="https?:\/\/[^"]+\/auth\/callback\.html\?token=[0-9a-f]+"/);
  assert.match(sent[0].text, /\/auth\/callback\.html\?token=[0-9a-f]+/);
});
