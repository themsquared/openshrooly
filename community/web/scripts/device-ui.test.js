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
