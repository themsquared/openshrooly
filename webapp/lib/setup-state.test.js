const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isApMode,
  hasActiveGrow,
  deviceSurfaceState,
  firstRunSteps,
  applyPresetWrites,
  presetSummary,
  connectionLabel,
  DEVICE_VERSION,
  GROW_PRESETS,
} = require("./setup-state.js");

test("AP mode is first-run Wi-Fi", () => {
  assert.equal(isApMode("Access Point", "OpenShrooly"), true);
  assert.equal(isApMode("Station", "Kitchen"), false);
  assert.equal(
    deviceSurfaceState({ wifiMode: "Access Point", ssid: "OpenShrooly", phase: "Idle", totalDays: 0, reachable: true }),
    "first-run-wifi"
  );
});

test("idle chamber is an empty grow, not a live recipe", () => {
  assert.equal(hasActiveGrow("Idle", 10), false);
  assert.equal(hasActiveGrow("Fruiting", 10), true);
  assert.equal(
    deviceSurfaceState({ wifiMode: "Station", ssid: "Home", phase: "Idle", totalDays: 0, reachable: true }),
    "empty-grow"
  );
});

test("unreachable wins over setup", () => {
  assert.equal(
    deviceSurfaceState({ wifiMode: "Access Point", reachable: false }),
    "unreachable"
  );
  assert.equal(firstRunSteps("unreachable").action, "retry");
});

test("fruiting preset writes grow caption and existing setpoint numbers", () => {
  const oyster = GROW_PRESETS.find((p) => p.id === "oyster-fruit");
  const writes = applyPresetWrites(oyster);
  assert.deepEqual(
    writes.map((w) => w.id),
    [
      "grow_phase",
      "grow_day",
      "grow_days_total",
      "target_humidity",
      "temperature__target",
      "lights__sunrise_hour",
      "lights__duration__hours_",
      "white_led_intensity",
      "red_led_intensity",
      "green_led_intensity",
      "blue_led_intensity",
    ]
  );
  assert.equal(writes[0].value, "Fruiting");
  assert.equal(writes.find((w) => w.id === "target_humidity").value, 90);
});

test("every preset says exactly what it will change", () => {
  for (const preset of GROW_PRESETS) {
    const summary = presetSummary(preset);
    assert.match(summary, new RegExp(`Humidity ${preset.setpoints.humidity}%`));
    assert.match(summary, new RegExp(`temperature ${preset.setpoints.temperature}°C`));
  }
  assert.equal(presetSummary(GROW_PRESETS.find((p) => p.id === "colonizing")), "Humidity 90%, temperature 24°C, lights off.");
  assert.equal(
    presetSummary(GROW_PRESETS.find((p) => p.id === "oyster-fruit")),
    "Humidity 90%, temperature 22°C, lights on 12 hours from 8 AM."
  );
  assert.equal(firstRunSteps("empty-grow").action, "profile");
});

test("presets stay inside the chamber's allowed ranges", () => {
  for (const preset of GROW_PRESETS) {
    const sp = preset.setpoints;
    assert.ok(sp.humidity >= 30 && sp.humidity <= 100);
    assert.ok(sp.temperature >= 15 && sp.temperature <= 35);
    assert.ok(sp.sunrise >= 0 && sp.sunrise <= 23);
    assert.ok(sp.lightHours >= 0 && sp.lightHours <= 24);
    assert.ok(preset.total >= 0 && preset.total <= 90);
  }
});

test("a home network whose name starts with OpenShrooly is not setup mode", () => {
  assert.equal(isApMode("Station", "OpenShrooly-guest"), false);
  assert.equal(isApMode("Station", "OpenShrooly"), false);
  assert.equal(isApMode("", "OpenShrooly"), true);
  assert.equal(connectionLabel("Station"), "Home Wi-Fi");
  assert.equal(connectionLabel("Access Point"), "Setup network");
});

test("shown version matches the firmware version", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const yaml = fs.readFileSync(path.join(__dirname, "..", "..", "esphome", "openshrooly.yaml"), "utf8");
  const match = yaml.match(/device_version:\s*"([^"]+)"/);
  assert.ok(match, "device_version not found in openshrooly.yaml");
  assert.equal(DEVICE_VERSION, match[1]);
});

test("writes become the same entity ids the dashboard already listens to", () => {
  const { entityPatchFromWrites } = require("./setup-state.js");
  const patch = entityPatchFromWrites(applyPresetWrites(GROW_PRESETS.find((p) => p.id === "colonizing")));
  assert.equal(patch["select-grow_phase"].state, "Colonizing");
  assert.equal(patch["number-grow_days_total"].value, 14);
  assert.equal(patch["number-target_humidity"].value, 90);
  assert.equal(patch["number-lights__duration__hours_"].value, 0);
  assert.equal(patch["number-white_led_intensity"].value, 0);
  assert.equal(patch["number-blue_led_intensity"].value, 0);
});

test("fruiting presets write duration and a complete mix", () => {
  const oyster = applyPresetWrites(GROW_PRESETS.find((p) => p.id === "oyster-fruit"));
  assert.equal(oyster.find((w) => w.id === "lights__duration__hours_").value, 12);
  assert.equal(oyster.find((w) => w.id === "white_led_intensity").value, 92);
  assert.equal(oyster.find((w) => w.id === "blue_led_intensity").value, 80);
});
