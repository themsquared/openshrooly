import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deviceOptions, feedbackSubject, linkedDevices, screenshotProblem, deviceFirmware, fillHidden } from "../public/js/feedback.js";

const html = readFileSync(new URL("../public/account/feedback.html", import.meta.url), "utf8");

test("feedback form is a static Netlify form with a honeypot, a subject field and a file field", () => {
  assert.match(html, /<form[^>]+name="beta-feedback"[^>]+data-netlify="true"[^>]+netlify-honeypot="company"/);
  assert.match(html, /enctype="multipart\/form-data"/);
  assert.match(html, /<input type="hidden" name="form-name" value="beta-feedback">/);
  assert.match(html, /<input type="hidden" name="subject"/);
  for (const n of ["user_id", "device_id", "firmware", "page_url", "browser"]) assert.match(html, new RegExp(`name="${n}"`));
  assert.match(html, /type="file" name="screenshot"/);
  assert.match(html, /Thanks, Mike reads every one/);
  assert.doesNotMatch(html, /mailto:/);
});

test("subject is easy to filter and never takes free text", () => {
  assert.equal(feedbackSubject("bug"), "Shroom Labs feedback: bug");
  assert.equal(feedbackSubject("idea"), "Shroom Labs feedback: idea");
  assert.equal(feedbackSubject("confusing"), "Shroom Labs feedback: confusing");
  assert.equal(feedbackSubject("<script>"), "Shroom Labs feedback: other");
});

test("only linked chambers count, and names are escaped in the picker", () => {
  const list = linkedDevices([{ id: "a", status: "active", name: "<b>Kitchen</b>" }, { id: "b", status: "revoked" }, null]);
  assert.equal(list.length, 1);
  assert.match(deviceOptions(list), /&lt;b&gt;Kitchen/);
  assert.equal(linkedDevices(undefined).length, 0);
});

test("screenshot limits and firmware lookup", () => {
  assert.equal(screenshotProblem(null), "");
  assert.match(screenshotProblem({ size: 10, type: "application/pdf" }), /image/);
  assert.match(screenshotProblem({ size: 6 * 1024 * 1024, type: "image/png" }), /5 MB/);
  assert.equal(screenshotProblem({ size: 1000, type: "image/png" }), "");
  assert.equal(deviceFirmware({ capabilities: { firmware: "1.0.5-sl.1" } }), "1.0.5-sl.1");
});

test("claim page carries the beta waitlist Netlify form and a feedback link", () => {
  const claim = readFileSync(new URL("../public/claim.html", import.meta.url), "utf8");
  assert.match(claim, /<form[^>]+name="beta-waitlist"[^>]+data-netlify="true"/);
  assert.match(claim, /href="\/account\/feedback"/);
  assert.doesNotMatch(claim, /opens soon/);
});

test("fillHidden takes the user from the /api/me shape", () => {
  const fields = {};
  const form = { elements: { namedItem: (n) => (fields[n] ??= { value: "" }) } };
  fillHidden(form, { me: { user: { id: 7, username: "grower_7" } }, device: { id: "sldev_1" }, href: "https://shroomlabs.io/device?id=sldev_1", userAgent: "UA" });
  assert.equal(fields.user_id.value, "7");
  assert.equal(fields.username.value, "grower_7");
  assert.equal(fields.device_id.value, "sldev_1");
  assert.equal(fields.page_url.value, "https://shroomlabs.io/device?id=sldev_1");
});
