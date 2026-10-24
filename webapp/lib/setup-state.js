/** First-run and empty-state helpers for the offline device UI. Pure, no DOM. */

const GROW_PRESETS = [
  {
    id: "colonizing",
    label: "Colonizing, 14 days",
    phase: "Colonizing",
    day: 1,
    total: 14,
    setpoints: { humidity: 90, temperature: 24, sunrise: 8, lightHours: 0 },
  },
  {
    id: "oyster-fruit",
    label: "Oyster fruiting, 10 days",
    phase: "Fruiting",
    day: 1,
    total: 10,
    setpoints: { humidity: 90, temperature: 22, sunrise: 8, lightHours: 12 },
  },
  {
    id: "lions-mane-fruit",
    label: "Lion's mane fruiting, 14 days",
    phase: "Fruiting",
    day: 1,
    total: 14,
    setpoints: { humidity: 90, temperature: 18, sunrise: 8, lightHours: 12 },
  },
];

function formatHour(hour) {
  const h = Number(hour) % 24;
  const suffix = h < 12 ? "AM" : "PM";
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve} ${suffix}`;
}

/** Plain summary of exactly what a preset will change, shown before it is applied. */
function presetSummary(preset) {
  const sp = preset.setpoints;
  if (!sp) return "Only the grow name and day count change.";
  const lights =
    sp.lightHours > 0 ? `lights on ${sp.lightHours} hours from ${formatHour(sp.sunrise)}` : "lights off";
  return `Humidity ${sp.humidity}%, temperature ${sp.temperature}°C, ${lights}.`;
}

/** Must match device_version in esphome/openshrooly.yaml (a test checks this). */
const DEVICE_VERSION = "1.0.3-sl.2";

function connectionLabel(wifiMode) {
  const mode = String(wifiMode || "");
  if (mode === "Station") return "Home Wi-Fi";
  if (mode === "Access Point") return "Setup network";
  return "Unknown";
}

function isApMode(wifiMode, ssid) {
  const mode = String(wifiMode || "");
  if (mode) return mode === "Access Point";
  // Mode not known yet: the device reports this exact name only for its own setup network.
  return String(ssid || "") === "OpenShrooly";
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
      body: "Make sure you are on the same Wi-Fi as the chamber. If Wi-Fi setup is on, join the network shown on the chamber screen and open 192.168.4.1.",
      action: "retry",
    };
  }
  if (state === "first-run-wifi") {
    return {
      title: "This chamber is in setup mode",
      body: "The chamber is not on your home Wi-Fi yet. Connect it to your home network to finish setup.",
      action: "wifi",
    };
  }
  if (state === "empty-grow") {
    return {
      title: "No grow is running",
      body: "Pick a starting point. It names the grow on the chamber screen and sets humidity, temperature, and lights. You can still change any of them later.",
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
  DEVICE_VERSION,
  connectionLabel,
  presetSummary,
  isApMode,
  hasActiveGrow,
  deviceSurfaceState,
  firstRunSteps,
  applyPresetWrites,
  entityPatchFromWrites,
};
