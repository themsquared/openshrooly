/**
 * A fake chamber that talks to the real Worker handlers the way firmware does: it pairs with the
 * real enroll, claim and CSR endpoints, signs every request with its key, pulls its inbox, applies
 * the commands under its own firmware rules, and reports state (and acks) in telemetry.
 *
 * Personalities are taken from real telemetry of the three kinds of chamber the site supports:
 *   lykyn    firmware 0.2.0, fan [33,100,1], percent light, phase names Colonization/Pinning/Fruiting, no grow day
 *   shrooly  firmware 1.0.6-sl.2, fan [15,100,5], lux light [0,4000], phases Idle/Colonizing/Pinning/Fruiting/Harvest, grow day
 *   generic  old firmware that only takes temperature and humidity
 *
 * The firmware refuses what it cannot take (out of range, off its step, unknown phase name) and
 * says so in an ack, so a command the cloud built wrongly shows up as a refusal, not as a pass.
 */
import { buildCsr, generateP256, jwkOf, signDeviceProof } from "../src/devices.js";
import { handleRequest } from "../src/handlers.js";

const PERSONALITIES = {
  lykyn: {
    device_type: "lykyn_chamber",
    model: "Lykyn",
    firmware_version: "0.2.0",
    capabilities: ["setpoints.temperature", "setpoints.humidity", "setpoints.multi", "ack.refused", "setpoints.fan", "air.schedule", "light.schedule", "light.color", "grow.phase"],
    ranges: {
      air_exchange_speed: [33, 100, 1],
      air_exchange_period_min: [1, 240, 1],
      air_exchange_run_sec: [5, 600, 5],
      sunrise_hour: [0, 23, 1],
      light_hours: [0, 24, 1],
      white_intensity: [0, 100, 0.1],
      color_r: [0, 100, 0.1],
      color_g: [0, 100, 0.1],
      color_b: [0, 100, 0.1],
    },
    temperature: { min: 5, max: 35, step: 0.5 },
    humidity: { min: 30, max: 95, step: 0.5 },
    phases: ["Colonization", "Pinning", "Fruiting"],
    growDay: false,
    start: { air_exchange_speed: 33, air_exchange_period_min: 60, air_exchange_run_sec: 15, sunrise_hour: 8, light_hours: 0, white_intensity: 0, color_r: 0, color_g: 0, color_b: 0, grow_phase: "Colonization" },
  },
  // Flashed fan-percent firmware: advertised range is 0-100, stall lift is hidden in PWM.
  lykyn_pwm: {
    device_type: "lykyn_chamber",
    model: "Lykyn",
    firmware_version: "0.2.0",
    capabilities: ["setpoints.temperature", "setpoints.humidity", "setpoints.multi", "ack.refused", "setpoints.fan", "air.schedule", "light.schedule", "light.color", "grow.phase"],
    ranges: {
      air_exchange_speed: [0, 100, 1],
      air_exchange_period_min: [1, 240, 1],
      air_exchange_run_sec: [5, 600, 5],
      sunrise_hour: [0, 23, 1],
      light_hours: [0, 24, 1],
      white_intensity: [0, 100, 0.1],
      color_r: [0, 100, 0.1],
      color_g: [0, 100, 0.1],
      color_b: [0, 100, 0.1],
    },
    temperature: { min: 5, max: 35, step: 0.5 },
    humidity: { min: 30, max: 95, step: 0.5 },
    phases: ["Colonization", "Pinning", "Fruiting"],
    growDay: false,
    start: { air_exchange_speed: 20, air_exchange_period_min: 60, air_exchange_run_sec: 15, sunrise_hour: 8, light_hours: 0, white_intensity: 0, color_r: 0, color_g: 0, color_b: 0, grow_phase: "Colonization" },
  },
  shrooly: {
    growDay: true,
    device_type: "shrooly_chamber",
    firmware_version: "1.0.6-sl.2",
    capabilities: ["setpoints.temperature", "setpoints.humidity", "setpoints.multi", "ack.refused", "setpoints.fan", "air.schedule", "light.schedule", "light.color", "grow.day", "grow.phase"],
    ranges: {
      air_exchange_speed: [15, 100, 5],
      air_exchange_period_min: [1, 240, 1],
      air_exchange_run_sec: [5, 900, 5],
      sunrise_hour: [0, 23, 1],
      light_hours: [0, 24, 0.25],
      white_intensity: [0, 4000, 5],
      color_r: [0, 100, 1],
      color_g: [0, 100, 1],
      color_b: [0, 100, 1],
      grow_day: [0, 90, 1],
    },
    temperature: { min: 15, max: 35, step: 0.1 },
    humidity: { min: 30, max: 100, step: 0.1 },
    phases: ["Idle", "Colonizing", "Pinning", "Fruiting", "Harvest"],
    growDay: true,
    start: { air_exchange_speed: 20, air_exchange_period_min: 60, air_exchange_run_sec: 15, sunrise_hour: 8, light_hours: 0, white_intensity: 0, color_r: 0, color_g: 0, color_b: 0, grow_phase: "Idle", grow_day: 1 },
  },
  generic: {
    device_type: null,
    firmware_version: null,
    capabilities: null,
    ranges: null,
    temperature: { min: 15, max: 35, step: 0.1 },
    humidity: { min: 30, max: 100, step: 0.1 },
    phases: [],
    growDay: false,
    start: {},
  },
};

const NUMERIC_KNOBS = [
  "air_exchange_speed",
  "air_exchange_period_min",
  "air_exchange_run_sec",
  "sunrise_hour",
  "light_hours",
  "white_intensity",
  "color_r",
  "color_g",
  "color_b",
  "grow_day",
];

export async function rawCall(ctx, method, path, { token, body, raw, headers: extra = {} } = {}) {
  const headers = { "content-type": "application/json", ...extra };
  if (token) headers.authorization = `Bearer ${token}`;
  const request = new Request(`http://test${path}`, {
    method,
    headers,
    body: raw !== undefined ? raw : body ? JSON.stringify(body) : undefined,
  });
  const res = await handleRequest(request, ctx);
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null, text };
}

function onStep(value, [lo, hi, step]) {
  if (value < lo - 1e-9 || value > hi + 1e-9) return false;
  const n = (value - lo) / step;
  return Math.abs(n - Math.round(n)) < 1e-6;
}

export class FakeChamber {
  constructor(ctx, kind, { name = kind } = {}) {
    if (!PERSONALITIES[kind]) throw new Error(`unknown chamber kind ${kind}`);
    this.ctx = ctx;
    this.kind = kind;
    this.name = name;
    this.p = PERSONALITIES[kind];
    this.offline = false;
    /** Commands the firmware will refuse, by id, with the reason it gives. */
    this.refuseIds = new Map();
    this.sensor = { temperature: 20, humidity: 85 };
    this.targets = { temperature_c: 20, humidity_percent: 85 };
    this.knobs = { ...this.p.start };
    this.lastAck = null;
    this.appliedLog = [];
    this.seenIds = [];
  }

  /** Pair through the real endpoints: enroll, owner claim, CSR. */
  async pair(token, hardware) {
    this.keys = await generateP256();
    const publicJwk = await jwkOf(this.keys.publicKey);
    const enrolled = await rawCall(this.ctx, "POST", "/api/devices/enroll", {
      body: { hardware_id: hardware || `hw-${this.kind}-${Math.random().toString(16).slice(2, 10)}`, public_jwk: publicJwk, name: this.name },
    });
    if (enrolled.status !== 200) throw new Error(`enroll ${enrolled.status} ${enrolled.text}`);
    this.id = enrolled.data.device_id;
    const claimed = await rawCall(this.ctx, "POST", "/api/devices/claim", { token, body: { code: enrolled.data.claim_code } });
    if (claimed.status !== 200) throw new Error(`claim ${claimed.status} ${claimed.text}`);
    const csr = await buildCsr(this.keys.privateKey, this.keys.publicKey, this.id);
    const issued = await this.signedCall("POST", `/api/devices/${this.id}/csr`, { csr, enroll_token: enrolled.data.enroll_token }, false);
    if (issued.status !== 200) throw new Error(`csr ${issued.status} ${issued.text}`);
    this.cert = { serial: issued.data.serial, fingerprint: issued.data.fingerprint };
    return this;
  }

  async signedCall(method, path, body, withCert = true) {
    const nonce = (await rawCall(this.ctx, "POST", `/api/devices/${this.id}/nonce`, { body: {} })).data.nonce;
    const raw = body === undefined ? "" : JSON.stringify(body);
    const proof = await signDeviceProof(this.keys.privateKey, { deviceId: this.id, nonce, method, path: path.split("?")[0], body: raw });
    const headers = { "x-device-nonce": nonce, "x-device-proof": proof };
    if (withCert && this.cert) {
      headers["x-device-cert-serial"] = this.cert.serial;
      if (this.cert.fingerprint) headers["x-device-cert-fingerprint"] = this.cert.fingerprint;
    }
    return rawCall(this.ctx, method, path, { raw: raw || undefined, headers });
  }

  /** What the chamber reports. Ack fields repeat until the next command, like the real firmware. */
  document() {
    const p = this.p;
    const doc = {
      temperature: this.sensor.temperature,
      temperature_c: this.sensor.temperature,
      humidity: this.sensor.humidity,
      humidity_percent: this.sensor.humidity,
      temperature_target: this.targets.temperature_c,
      temperature_setpoint: this.targets.temperature_c,
      target_humidity: this.targets.humidity_percent,
      humidity_setpoint: this.targets.humidity_percent,
      temperature_target_min: p.temperature.min,
      temperature_target_max: p.temperature.max,
      target_humidity_min: p.humidity.min,
      target_humidity_max: p.humidity.max,
    };
    if (this.kind !== "generic") Object.assign(doc, this.knobs);
    if (p.firmware_version) doc.firmware_version = p.firmware_version;
    if (p.capabilities) doc.capabilities = p.capabilities;
    if (p.ranges) doc.ranges = p.ranges;
    if (p.device_type === "lykyn_chamber") {
      doc.device_type = p.device_type;
      doc.model = p.model;
      doc.temperature_target_step = p.temperature.step;
      doc.target_humidity_step = p.humidity.step;
    }
    if (this.lastAck) {
      doc.ack_command_id = this.lastAck.id;
      doc.ack_status = this.lastAck.status;
      if (this.lastAck.reason) doc.ack_reason = this.lastAck.reason;
    }
    return doc;
  }

  async report() {
    if (this.offline) return null;
    const res = await this.signedCall("POST", `/api/devices/${this.id}/telemetry`, this.document());
    if (res.status !== 200) throw new Error(`telemetry ${res.status} ${res.text}`);
    return res;
  }

  /** Pull the inbox and apply what it hands out. Returns the commands the cloud handed out. */
  async poll() {
    if (this.offline) return [];
    const res = await this.signedCall("GET", `/api/devices/${this.id}/inbox`);
    if (res.status !== 200) throw new Error(`inbox ${res.status} ${res.text}`);
    const handed = res.data.commands || [];
    for (const command of handed) {
      this.seenIds.push(command.id);
      if (command.apply === false) continue;
      this.apply(command);
    }
    return handed;
  }

  /** One firmware cycle: pull the inbox, then report. */
  async cycle() {
    const handed = await this.poll();
    await this.report();
    return handed;
  }

  refuse(command, reason) {
    this.lastAck = { id: command.id, status: "refused", reason };
    this.appliedLog.push({ id: command.id, status: "refused", reason });
  }

  apply(command) {
    const p = this.p;
    const payload = command.payload || {};
    if (this.refuseIds.has(command.id)) return this.refuse(command, this.refuseIds.get(command.id));
    if (command.kind !== "setpoints") return this.refuse(command, `cannot take ${command.kind}`);
    const next = { targets: { ...this.targets }, knobs: { ...this.knobs } };
    if (payload.temperature_c != null) {
      const t = Number(payload.temperature_c);
      if (!onStep(t, [p.temperature.min, p.temperature.max, p.temperature.step])) return this.refuse(command, `temperature ${t} out of range`);
      next.targets.temperature_c = t;
    }
    if (payload.humidity_percent != null) {
      const h = Number(payload.humidity_percent);
      if (!onStep(h, [p.humidity.min, p.humidity.max, p.humidity.step])) return this.refuse(command, `humidity ${h} out of range`);
      next.targets.humidity_percent = h;
    }
    if (p.ranges) {
      for (const key of NUMERIC_KNOBS) {
        if (payload[key] == null) continue;
        if (key === "grow_day" && !p.growDay) continue;
        const range = p.ranges[key];
        if (!range) continue;
        const v = Number(payload[key]);
        if (!onStep(v, range)) return this.refuse(command, `${key} ${v} outside ${range.join("/")}`);
        next.knobs[key] = v;
      }
      if (payload.grow_phase != null) {
        if (!p.phases.includes(payload.grow_phase)) return this.refuse(command, `unknown phase ${payload.grow_phase}`);
        next.knobs.grow_phase = payload.grow_phase;
      }
    }
    this.targets = next.targets;
    this.knobs = next.knobs;
    this.lastAck = { id: command.id, status: "applied" };
    this.appliedLog.push({ id: command.id, status: "applied", payload });
  }

  /** A hands-on change at the chamber itself (not a cloud command). */
  setLocal({ temperature_c, humidity_percent, ...knobs }) {
    if (temperature_c != null) this.targets.temperature_c = temperature_c;
    if (humidity_percent != null) this.targets.humidity_percent = humidity_percent;
    Object.assign(this.knobs, knobs);
  }
}
