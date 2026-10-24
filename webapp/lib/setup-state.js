/** First-run and empty-state helpers for the offline device UI. Pure, no DOM. */

const GROW_PRESETS = [
  {
    id: "idle",
    label: "No grow",
    detail: "Climate keeps running. The screen says Idle.",
    phase: "Idle",
    day: 0,
    total: 0,
    setpoints: null,
  },
  {
    id: "colonizing",
    label: "Colonizing, 14 days",
    detail: "Caption only plus typical colonization setpoints you can still edit.",
    phase: "Colonizing",
    day: 1,
    total: 14,
    setpoints: { humidity: 90, temperature: 24, sunrise: 8, lightHours: 0 },
  },
  {
    id: "oyster-fruit",
    label: "Oyster fruiting, 10 days",
    detail: "Culinary oyster-style fruiting caption and setpoints.",
    phase: "Fruiting",
    day: 1,
    total: 10,
    setpoints: { humidity: 90, temperature: 22, sunrise: 8, lightHours: 12 },
  },
  {
    id: "lions-mane-fruit",
    label: "Lion's mane fruiting, 14 days",
    detail: "Cooler fruiting caption and setpoints.",
    phase: "Fruiting",
    day: 1,
    total: 14,
    setpoints: { humidity: 90, temperature: 18, sunrise: 8, lightHours: 12 },
  },
];

function isApMode(wifiMode, ssid) {
  const mode = String(wifiMode || "");
  const name = String(ssid || "");
  return mode === "Access Point" || name === "OpenShrooly" || name.startsWith("OpenShrooly");
}

function hasActiveGrow(phase, totalDays) {
  const name = String(phase || "").trim();
  const total = Number(totalDays || 0);
  return Boolean(name) && name !== "Idle" && total > 0;
}

function deviceSurfaceState({ wifiMode, ssid, phase, totalDays, reachable, lastError }) {
  if (reachable === false) return "unreachable";
  if (lastError && reachable !== true) return "unreachable";
  if (isApMode(wifiMode, ssid)) return "first-run-wifi";
  if (!hasActiveGrow(phase, totalDays)) return "empty-grow";
  return "ready";
}

function firstRunSteps(state) {
  if (state === "unreachable") {
    return {
      title: "Cannot reach the chamber",
      body: "Open this page on the same Wi-Fi, or join the OpenShrooly access point at 192.168.4.1.",
      action: "retry",
    };
  }
  if (state === "first-run-wifi") {
    return {
      title: "This chamber is in setup mode",
      body: "You are on the device access point. Name the chamber, then join your home Wi-Fi from the phone captive portal or the ESPHome Wi-Fi form at /.",
      action: "wifi",
    };
  }
  if (state === "empty-grow") {
    return {
      title: "No grow is running",
      body: "Pick a culinary stage for the e-paper caption. Setpoints use the same humidity, temperature, and light numbers as the sliders.",
      action: "profile",
    };
  }
  return { title: "", body: "", action: "none" };
}

function applyPresetWrites(preset) {
  const writes = [
    { kind: "select", id: "grow_phase", value: preset.phase },
    { kind: "number", id: "grow_day", value: preset.day },
    { kind: "number", id: "grow_days_total", value: preset.total },
  ];
  if (preset.setpoints) {
    writes.push({ kind: "number", id: "target_humidity", value: preset.setpoints.humidity });
    writes.push({ kind: "number", id: "temperature__target", value: preset.setpoints.temperature });
    writes.push({ kind: "number", id: "lights__sunrise_hour", value: preset.setpoints.sunrise });
    writes.push({ kind: "number", id: "lights__duration__hours_", value: preset.setpoints.lightHours });
  }
  return writes;
}

function entityPatchFromWrites(writes) {
  const patch = {};
  for (const write of writes) {
    if (write.kind === "select") {
      patch[`select-${write.id}`] = { state: write.value, value: write.value };
    } else {
      patch[`number-${write.id}`] = { state: String(write.value), value: write.value };
    }
  }
  return patch;
}

module.exports = {
  GROW_PRESETS,
  isApMode,
  hasActiveGrow,
  deviceSurfaceState,
  firstRunSteps,
  applyPresetWrites,
  entityPatchFromWrites,
};
