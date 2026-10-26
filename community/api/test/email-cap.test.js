import { test } from "node:test";
import assert from "node:assert/strict";
import { emailCaps, sendEmail } from "../src/email.js";
import { call, testEnv } from "./helpers.js";

/** Replaces fetch so nothing ever reaches Resend. */
function fakeResend() {
  const sent = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    sent.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ id: "fake" }), { status: 200 });
  };
  return { sent, restore: () => (globalThis.fetch = original) };
}

function quiet(fn) {
  const original = console.error;
  const lines = [];
  console.error = (line) => lines.push(String(line));
  return fn().finally(() => (console.error = original)).then((value) => ({ value, lines }));
}

test("email caps default under the provider quota and read env overrides", () => {
  assert.deepEqual(emailCaps({}), { total: 300, bulk: 200 });
  assert.deepEqual(emailCaps({ EMAIL_DAILY_CAP: "10", EMAIL_DAILY_BULK_CAP: "50" }), { total: 10, bulk: 10 });
});

test("bulk mail stops at its cap, sign-in links keep the rest, then everything stops", async () => {
  const ctx = testEnv({ RESEND_API_KEY: "re_test_never_sent", EMAIL_DAILY_CAP: "3", EMAIL_DAILY_BULK_CAP: "1" });
  delete ctx.DEV_STUBS;
  const resend = fakeResend();
  try {
    const msg = { to: "a@example.com", subject: "s", text: "t" };
    assert.equal((await sendEmail(ctx, msg)).ok, true);
    const { value: bulk, lines } = await quiet(() => sendEmail(ctx, msg));
    assert.equal(bulk.capped, true);
    assert.ok(lines.some((line) => line.includes("email_daily_cap")));
    assert.equal((await sendEmail(ctx, { ...msg, priority: "login" })).ok, true);
    assert.equal((await sendEmail(ctx, { ...msg, priority: "login" })).ok, true);
    const { value: over } = await quiet(() => sendEmail(ctx, { ...msg, priority: "login" }));
    assert.equal(over.capped, true);
    assert.equal(resend.sent.length, 3);
  } finally {
    resend.restore();
  }
});

test("sign-in returns a plain 429 when the daily cap is used up", async () => {
  const ctx = testEnv({ RESEND_API_KEY: "re_test_never_sent", EMAIL_DAILY_CAP: "0" });
  const resend = fakeResend();
  try {
    const { value: res } = await quiet(() =>
      call(ctx, "POST", "/api/auth/magic/start", { body: { email: "cap@example.com", turnstile: "ok" } })
    );
    assert.equal(res.status, 429, JSON.stringify(res.data));
    assert.match(res.data.error, /Try again in a few hours/);
    assert.equal(resend.sent.length, 0);
  } finally {
    resend.restore();
  }
});
