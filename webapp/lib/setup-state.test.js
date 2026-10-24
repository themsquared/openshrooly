const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isApMode,
  hasActiveGrow,
  deviceSurfaceState,
  firstRunSteps,
  applyPresetWrites,
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
    ["grow_phase", "grow_day", "grow_days_total", "target_humidity", "temperature__target", "lights__sunrise_hour", "lights__duration__hours_"]
  );
  assert.equal(writes[0].value, "Fruiting");
  assert.equal(writes.find((w) => w.id === "target_humidity").value, 90);
});

test("idle preset does not touch climate numbers", () => {
  const idle = GROW_PRESETS.find((p) => p.id === "idle");
  const writes = applyPresetWrites(idle);
  assert.equal(writes.some((w) => w.id === "target_humidity"), false);
  assert.equal(firstRunSteps("empty-grow").action, "profile");
});

test("writes become the same entity ids the dashboard already listens to", () => {
  const { entityPatchFromWrites } = require("./setup-state.js");
  const patch = entityPatchFromWrites(applyPresetWrites(GROW_PRESETS.find((p) => p.id === "colonizing")));
  assert.equal(patch["select-grow_phase"].state, "Colonizing");
  assert.equal(patch["number-grow_days_total"].value, 14);
  assert.equal(patch["number-target_humidity"].value, 90);
});
