/**
 * AC Infinity adapter: maps a Shroom Labs profile stage to AC Infinity UIS port settings
 * and writes them through the AC Infinity cloud API.
 *
 * Community, untested. The cloud API is not published by AC Infinity. Every endpoint, field
 * name, and unit here comes from the community Home Assistant integration
 * https://github.com/dalinicus/homeassistant-acinfinity (MIT), read at commit
 * 1285e94531f1b98eccea0e7f5deaa1fd31c7796c (2026-10-26):
 *   custom_components/ac_infinity/client.py   endpoints, headers, login, read then write
 *   custom_components/ac_infinity/const.py    host, port field names, mode numbers
 *   custom_components/ac_infinity/number.py   units: cycle times in seconds, °C with a matching °F field, speed 0 to 10
 * The same integration lists Controller 69 WiFi, 69 Pro, 69 Pro+ and AI+ as cloud capable. The base
 * Controller 69 and Controller 67 are Bluetooth only and cannot use this adapter.
 * AI+ uses a different write call in that integration and is not handled here.
 *
 * Credentials come only from the caller (see configFromEnv). Nothing here stores or logs them.
 */

export const HOST = "https://www.acinfinityserver.com";
export const SOURCE = "https://github.com/dalinicus/homeassistant-acinfinity";

const PATH = {
  login: "/api/user/appUserLogin",
  controllers: "/api/user/devInfoListAll",
  portSettings: "/api/dev/getdevModeSettingList",
  addDevMode: "/api/dev/addDevMode",
};

/** Port modes (AtType in const.py). */
export const MODE = { OFF: 1, ON: 2, AUTO: 3, TIMER_TO_ON: 4, TIMER_TO_OFF: 5, CYCLE: 6, SCHEDULE: 7, VPD: 8 };

/** Every port control field the write sends back (DeviceControlKey in const.py). The API wants the whole set. */
export const CONTROL_KEYS = ["devId", "externalPort", "modeSetid", "modeType", "masterPort", "surplus", "onSpead", "offSpead", "onSelfSpead", "atType", "powerState", "power", "loadState", "loadType", "speak", "abnormalState", "toward", "schedStartTime", "schedEndtTime", "acitveTimerOn", "acitveTimerOff", "activeCycleOn", "activeCycleOff", "activeHtVpd", "activeHtVpdNums", "activeLtVpd", "activeLtVpdNums", "vpdstatus", "vpdnums", "vpdSettingMode", "targetVpd", "targetVpdSwitch", "isUpdateVpdNums", "devHt", "activeHt", "devLt", "activeLt", "temperature", "targetTemp", "targetTSwitch", "insideTemp", "outsideTemp", "devHtf", "devLtf", "temperatureF", "targetTempF", "devHh", "activeHh", "devLh", "activeLh", "humidity", "targetHumi", "targetHumiSwitch", "photocellSwitch", "trend", "tTrend", "hTrend", "insideTrend", "outsideTrend", "unit", "ecOrTds", "ecUnit", "tdsUnit", "ecTdsSettingMode", "ecTdsAccuracy", "ecTdsTargetSwitch", "ecTdsTargetValueEcUs", "ecTdsTargetValueEcMs", "ecTdsTargetValueTdsPpm", "ecTdsTargetValueTdsPpt", "ecTdsHighSwitch", "ecTdsHighValueEcUs", "ecTdsHighValueEcMs", "ecTdsHighValueTdsPpm", "ecTdsHighValueTdsPpt", "ecTdsLowSwitchEc", "ecTdsLowSwitchTds", "ecTdsLowValueEcUs", "ecTdsLowValueEcMs", "ecTdsLowValueTdsPpm", "ecTdsLowValueTdsPpt", "phSettingMode", "phAccuracy", "phTargetSwitch", "phTargetValue", "phHighSwitch", "phHighValue", "phLowSwitch", "phLowValue", "co2SettingMode", "co2Accuracy", "co2TargetSwitch", "co2TargetValue", "co2HighSwitch", "co2HighValue", "co2LowSwitch", "co2LowValue", "co2FanSettingMode", "co2FanAccuracy", "co2FanTargetSwitch", "co2FanTargetValue", "co2FanHighSwitch", "co2FanHighValue", "co2FanLowSwitch", "co2FanLowValue", "moistureSettingMode", "moistureAccuracy", "moistureTargetSwitch", "moistureTargetValue", "moistureHighSwitch", "moistureHighValue", "moistureLowSwitch", "moistureLowValue", "waterLevelSettingMode", "waterLevelAccuracy", "waterLevelTargetSwitch", "waterLevelTargetValue", "waterLevelHighSwitch", "waterLevelHighValue", "waterLevelLowSwitch", "waterLevelLowValue", "waterTempSettingMode", "waterTempAccuracy", "waterTempTargetSwitch", "waterTempTargetValue", "waterTempHighSwitch", "waterTempHighValue", "waterTempLowSwitch", "waterTempLowValue", "waterTempTargetValueF", "waterTempHighValueF", "waterTempLowValueF", "isOpenAutomation", "settingMode", "onlyUpdateSpeed", "restore", "devSetting"];

export class AcInfinityError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.name = "AcInfinityError";
    this.status = status;
    this.code = code;
  }
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const toF = (c) => Math.round(c * 1.8 + 32);
/** Port speed is 10 levels. A running device gets at least level 1. */
export const speedLevel = (percent) => clamp(Math.round(Number(percent) / 10), 1, 10);

/**
 * Port settings for one stage. `ports` says which UIS port holds which device, for example
 * { humidifier: 1, fan: 2, heater: 3 }. Leave a device out if you do not have it.
 * Returns [{ port, device, values, notes }]. Pure: no network.
 *
 * Mapping, per the Controller 69 PRO manual's AUTO mode:
 * - Humidifier: AUTO with only the low humidity trigger on, set to the stage target. It runs when
 *   humidity is at or under the trigger and stops above it.
 * - Heater: AUTO with only the low temperature trigger on, at target minus the stage hysteresis.
 *   Skipped when the stage turns temperature control off.
 * - Fan: CYCLE, on for the stage run time, off for the rest of the period. The integration sets
 *   cycle times in whole minutes, so seconds are rounded up to the next minute and noted.
 */
export function stagePortSettings(stage, ports = {}) {
  if (!stage || typeof stage !== "object") throw new AcInfinityError("stage is required");
  const out = [];
  const portNo = (name) => {
    const p = ports[name];
    if (p === undefined || p === null) return null;
    if (!Number.isInteger(p) || p < 1 || p > 8) throw new AcInfinityError(`${name} port must be 1 to 8`);
    return p;
  };
  const used = new Set();
  const add = (device, port, values, notes = []) => {
    if (used.has(port)) throw new AcInfinityError(`port ${port} is assigned twice`);
    used.add(port);
    out.push({ port, device, values, notes });
  };

  const hp = portNo("humidifier");
  if (hp !== null && Number.isFinite(stage.humidity_percent)) {
    add("humidifier", hp, {
      atType: MODE.AUTO,
      activeLh: 1,
      devLh: clamp(Math.round(stage.humidity_percent), 0, 100),
      activeHh: 0,
      activeHt: 0,
      activeLt: 0,
      onSpead: speedLevel(stage.humidifier_speed_percent ?? 100),
      offSpead: 0,
    });
  }

  const tp = portNo("heater");
  if (tp !== null && stage.temperature_control_enabled !== false && Number.isFinite(stage.temperature_c)) {
    const c = Math.round(stage.temperature_c - (Number(stage.temperature_hysteresis) || 0));
    add("heater", tp, { atType: MODE.AUTO, activeLt: 1, devLt: c, devLtf: toF(c), activeHt: 0, activeHh: 0, activeLh: 0, onSpead: 10, offSpead: 0 });
  }

  const fp = portNo("fan");
  if (fp !== null && stage.fan && Number.isFinite(stage.fan.period_min) && Number.isFinite(stage.fan.run_duration_s)) {
    const periodS = stage.fan.period_min * 60;
    const onMin = Math.max(1, Math.ceil(stage.fan.run_duration_s / 60));
    const offMin = Math.max(1, Math.round(periodS / 60) - onMin);
    const notes = [];
    if (onMin * 60 !== stage.fan.run_duration_s) notes.push(`fan run ${stage.fan.run_duration_s} s rounded up to ${onMin} min`);
    add("fan", fp, {
      atType: MODE.CYCLE,
      activeCycleOn: onMin * 60,
      activeCycleOff: offMin * 60,
      onSpead: speedLevel(stage.fan.speed_percent ?? 100),
      offSpead: 0,
    }, notes);
  }
  return out;
}

/** Form-encode the way the integration's aiohttp client does: booleans lowercase, objects as JSON. */
function encode(values) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(values)) {
    if (v === null || v === undefined) p.append(k, "0");
    else if (typeof v === "object") p.append(k, JSON.stringify(v));
    else p.append(k, String(v));
  }
  return p.toString();
}

/**
 * Cloud client. `fetch` is injectable so tests never touch the network.
 * Login: POST appEmail and appPasswordl (the field name really ends in l). The app cuts passwords
 * to 25 characters, so this does too. The returned appId is sent as the `token` header.
 */
export function createAcInfinityClient({ email, password, host = HOST, fetch: doFetch = globalThis.fetch, timeoutMs = 10000 } = {}) {
  if (!email || !password) throw new AcInfinityError("AC Infinity email and password are required");
  let token = null;

  async function post(path, body, { auth = true } = {}) {
    if (auth && !token) throw new AcInfinityError("not logged in");
    const headers = { "User-Agent": "okhttp/4.12.0", "Content-Type": "application/x-www-form-urlencoded" };
    if (auth) headers.token = token;
    const res = await doFetch(`${host}${path}`, { method: "POST", headers, body: body ? encode(body) : undefined, signal: AbortSignal.timeout(timeoutMs) });
    if (res.status !== 200) throw new AcInfinityError(`AC Infinity cloud returned HTTP ${res.status}`, { status: res.status });
    const json = await res.json();
    if (json.code !== 200) {
      if (path === PATH.login) throw new AcInfinityError("AC Infinity sign in failed: check the email and password", { code: json.code });
      throw new AcInfinityError(`AC Infinity request failed: ${json.msg || json.code}`, { code: json.code });
    }
    return json;
  }

  return {
    async login() {
      const json = await post(PATH.login, { appEmail: email, appPasswordl: String(password).slice(0, 25) }, { auth: false });
      token = json.data?.appId;
      if (!token) throw new AcInfinityError("AC Infinity sign in returned no user id");
      return true;
    },
    isLoggedIn: () => Boolean(token),
    async controllers() {
      return (await post(PATH.controllers, { userId: token })).data;
    },
    async portSettings(controllerId, port) {
      return (await post(PATH.portSettings, { devId: controllerId, port })).data;
    },
    /** Read the port, overlay the new values, and send every control field back, like the integration. */
    async updatePort(controllerId, port, values) {
      const existing = (await post(PATH.portSettings, { devId: controllerId, port })).data || {};
      const merged = {};
      for (const k of CONTROL_KEYS) {
        const v = k in values ? values[k] : k in existing ? existing[k] : 0;
        merged[k] = v === null ? 0 : typeof v === "boolean" ? String(v) : v;
      }
      await post(`${PATH.addDevMode}?${encode(merged)}`, null);
      return merged;
    },
  };
}

/**
 * Apply a stage. Dry run by default: returns the plan and sends nothing.
 * With apply: true it logs in if needed and writes each port in turn.
 */
export async function applyStage({ client, controllerId, ports, stage, apply = false }) {
  const plan = stagePortSettings(stage, ports);
  if (!apply) return { applied: false, plan };
  if (!client) throw new AcInfinityError("client is required to apply");
  if (controllerId === undefined || controllerId === null || controllerId === "") throw new AcInfinityError("controller id is required to apply");
  if (!client.isLoggedIn()) await client.login();
  for (const p of plan) await client.updatePort(controllerId, p.port, p.values);
  return { applied: true, plan };
}

/**
 * Config from environment variables. Keep them in a local .env or your shell, never in git.
 * AC_INFINITY_EMAIL, AC_INFINITY_PASSWORD, AC_INFINITY_CONTROLLER_ID,
 * AC_INFINITY_PORT_HUMIDIFIER, AC_INFINITY_PORT_FAN, AC_INFINITY_PORT_HEATER
 */
export function configFromEnv(env = process.env) {
  const port = (k) => (env[k] ? Number(env[k]) : undefined);
  const ports = {};
  for (const [name, key] of [["humidifier", "AC_INFINITY_PORT_HUMIDIFIER"], ["fan", "AC_INFINITY_PORT_FAN"], ["heater", "AC_INFINITY_PORT_HEATER"]]) {
    const v = port(key);
    if (v !== undefined) ports[name] = v;
  }
  return { email: env.AC_INFINITY_EMAIL, password: env.AC_INFINITY_PASSWORD, controllerId: env.AC_INFINITY_CONTROLLER_ID, ports };
}
