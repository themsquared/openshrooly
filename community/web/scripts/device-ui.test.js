import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  demoDevices,
  deviceTypeLabel,
  growLine,
  renderControls,
  renderDeviceCard,
  renderDeviceCards,
  renderIdentity,
  speciesLine,
  renderCommandList,
  resultMessage,
  commandStatusLabel,
  commandPending,
  newRequestId,
} from "../public/js/device-ui.js";

const DASH = /[\u2013\u2014]/;
const pearl = demoDevices()[0];

test("device type label keeps Shrooly as the hardware name only", () => {
  assert.equal(deviceTypeLabel("shrooly_chamber"), "Shrooly chamber");
  assert.equal(deviceTypeLabel(""), "Shrooly chamber");
});

test("device cards make species and grow identity obvious", () => {
  const html = renderDeviceCards(demoDevices());
  assert.match(html, /Pleurotus ostreatus/);
  assert.match(html, /Pearl Oyster/);
  assert.match(html, /Fruiting/);
  assert.match(html, /day 6 of 29/);
  assert.match(html, /Shrooly chamber/);
  assert.match(html, /Kitchen chamber/);
  assert.match(html, /device\.html\?id=demo-kitchen/);
  assert.match(html, /species-oyster|pearl-oyster|Pleurotus/);
  assert.doesNotMatch(html, DASH);
  assert.doesNotMatch(html, /setpoint/i);
});

test("empty device list is plain copy", () => {
  assert.match(renderDeviceCards([]), /No devices linked yet/);
});

test("device page identity and controls use chamber names, not product Shrooly", () => {
  const identity = renderIdentity(pearl);
  assert.match(identity, /What is growing/);
  assert.match(identity, /Pleurotus ostreatus/);
  assert.match(identity, /Pearl Oyster/);
  const controls = renderControls(pearl, { profiles: [pearl.profile], canWrite: true, showCoach: true });
  assert.match(controls, /Target temperature/);
  assert.match(controls, /Target humidity/);
  assert.match(controls, /Fan speed/);
  assert.match(controls, /Light/);
  assert.match(controls, /Advisor/);
  assert.doesNotMatch(controls, /setpoint/i);
  assert.doesNotMatch(identity + controls, DASH);
  const offMenu = renderControls({ ...pearl, off_menu: true, coach: null }, { canWrite: true, showCoach: true });
  assert.doesNotMatch(offMenu, /Coach Autopilot|Coach mode/);
});

test("offline devices keep controls read only", () => {
  const html = renderControls({ ...pearl, online: false, controllable: true }, { canWrite: false });
  assert.match(html, /disabled/);
  assert.match(html, /offline/);
});

test("grow line falls back when no profile is set", () => {
  assert.equal(speciesLine({}), "");
  assert.equal(growLine({}), "No grow selected");
});

test("account page keeps the old hooks inside named sections", () => {
  const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../public/account.html"), "utf8");
  for (const id of ["profile", "devices", "billing", "security", "community", "who", "verified", "device-cards", "alert-prefs", "sessions", "signout-all", "mint", "my-profiles", "ents", "coach-account"]) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
  assert.match(html, /Account sections/);
  assert.match(html, /Subscriptions and billing/);
  assert.doesNotMatch(html.replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " "), DASH);
});

test("public device pages stay dash-free", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "../public");
  for (const name of ["devices.html", "device.html"]) {
    const html = readFileSync(join(root, name), "utf8")
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ");
    const text = html.replace(/<[^>]+>/g, " ");
    assert.doesNotMatch(text, DASH, name);
    assert.doesNotMatch(text, /setpoint/i, name);
  }
});

// What the API sends for a 1.0.4-sl.2 chamber: setpoints only, no firmware version reported.
const SL2_CONTROLS = {
  temperature: { supported: true, note: null },
  humidity: { supported: true, note: null },
  fan: { supported: false, note: "This chamber's firmware can't change fan speed from the cloud yet. Set it on the chamber." },
  light: { supported: false, note: "This chamber's firmware can't take light settings from the cloud yet. Set them on the chamber." },
  profile: {
    supported: true,
    mode: "translated",
    note: "This chamber's firmware can't load a whole profile, so Apply sends the phase's temperature and humidity targets.",
  },
};
const sl2 = { ...pearl, firmware: null, capabilities: { source: "inferred", list: ["setpoints.temperature", "setpoints.humidity"] }, controls: SL2_CONTROLS };

function tagFor(html, name) {
  return html.match(new RegExp(`<input name="${name}"[^>]*>`))[0];
}

test("controls the firmware can't take are disabled with a plain note", () => {
  const html = renderControls(sl2, { profiles: [pearl.profile], canWrite: true });
  assert.match(tagFor(html, "fan_speed_percent"), /disabled/);
  assert.match(tagFor(html, "white_led_lux"), /disabled/);
  assert.match(html, /<button type="submit" data-action="light" disabled>/);
  assert.doesNotMatch(tagFor(html, "temperature_c"), /disabled/);
  assert.doesNotMatch(tagFor(html, "humidity_percent"), /disabled/);
  assert.match(html, /<button type="submit" data-action="profile">/);
  assert.match(html, /can't change fan speed from the cloud/);
  assert.match(html, /can't take light settings from the cloud/);
  assert.match(html, /can't load a whole profile/);
  assert.match(html, /Firmware version not reported/);
  assert.doesNotMatch(html, DASH);
});

test("a chamber that reports light support keeps the light controls on", () => {
  const html = renderControls(
    { ...sl2, firmware: "2.0.0", capabilities: { source: "reported" }, controls: { ...SL2_CONTROLS, light: { supported: true, note: null } } },
    { canWrite: true }
  );
  assert.doesNotMatch(tagFor(html, "white_led_lux"), /disabled/);
  assert.match(html, /Firmware 2\.0\.0/);
});

test("command states read plainly and queued is never called applied", () => {
  assert.equal(commandStatusLabel("queued"), "Queued, waiting for the chamber");
  assert.equal(commandStatusLabel("delivered"), "Delivered, not confirmed yet");
  assert.equal(commandStatusLabel("applied"), "Applied, confirmed by the chamber");
  assert.equal(commandStatusLabel("expired"), "Expired");
  assert.ok(commandPending({ status: "queued" }));
  assert.ok(commandPending({ status: "delivered" }));
  assert.ok(!commandPending({ status: "applied" }));
  const html = renderCommandList([
    { id: 2, kind: "apply_profile", status: "delivered", summary: "Profile lions-mane, fruiting", reason: "This chamber's firmware can't run profile commands, so it will not be applied.", issued_at: "2026-10-25T19:14:08Z" },
    { id: 1, kind: "setpoints", status: "applied", summary: "17 °C, 90% RH", issued_at: "2026-10-25T19:05:00Z" },
  ]);
  assert.match(html, /Delivered, not confirmed yet/);
  assert.match(html, /can't run profile commands/);
  assert.match(html, /Applied, confirmed by the chamber/);
  assert.match(renderCommandList([]), /Nothing sent from the cloud yet/);
  const queued = resultMessage({ status: "queued", command_id: 5 });
  assert.match(queued, /Queued/);
  assert.doesNotMatch(queued.replace(/shows as applied only after/, ""), /applied/i);
  assert.match(resultMessage({ status: "queued", deduped: true }), /already sent/);
  assert.match(resultMessage({ status: "failed", error: "No light from the cloud." }), /No light/);
});

test("each submit gets its own request id", () => {
  const a = newRequestId();
  const b = newRequestId();
  assert.ok(a && b && a !== b);
});
