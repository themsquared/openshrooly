/**
 * Private admin page API: /api/admin/*. Read only.
 * Only user ids in ADMIN_USER_IDS (default "82") get data. Everyone else, signed in or not,
 * gets the same 404 as an unknown route, so the routes do not show up as existing.
 */

import { userFromRequest } from "./auth.js";
import { ADMIN_SQL } from "./admin-sql.js";
import { COACH_ITEM } from "./coach-learn.js";
import { betaLinkCap, countLinkedDevices } from "./devices.js";
import { betaActive, betaOwnerIds } from "./coach-access.js";
import { isCoachBetaUser } from "./providers.js";
import { deviceIsOnline, enrichDevice } from "./fleet.js";
import { jevCost } from "./jev.js";

/** Measured cost of one Jev decision when the token count is unknown. */
export const JEV_COST_PER_DECISION = 0.000114;
/** Workers AI list price per 1,000 neurons (Grow Coach chat and photos). */
export const NEURON_COST_PER_K = 0.011;
const DAY_MS = 86400000;
const WINDOWS = Object.freeze({ today: null, "7d": 7, "30d": 30 });

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" },
  });
}

const notFound = () =>
  new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: { "content-type": "application/json; charset=utf-8" } });

export function adminIds(env = {}) {
  const raw = env.ADMIN_USER_IDS === undefined || env.ADMIN_USER_IDS === null ? "82" : String(env.ADMIN_USER_IDS);
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => /^\d+$/.test(s))
      .map(Number)
  );
}

export function isAdmin(env, user) {
  return Boolean(user && user.id != null && adminIds(env).has(Number(user.id)));
}

const ROUTES = {
  "/api/admin/overview": overview,
  "/api/admin/users": users,
  "/api/admin/devices": devices,
  "/api/admin/activations": activations,
  "/api/admin/spend": spend,
};

export async function handleAdmin(method, path, url, request, env) {
  if (path !== "/api/admin" && !path.startsWith("/api/admin/")) return null;
  const { user } = await userFromRequest(request, env.db);
  if (!isAdmin(env, user)) return notFound();
  const fn = ROUTES[path];
  if (!fn || method !== "GET") return notFound();
  return json(await fn(env, { now: Date.now() }));
}

/* ---------- helpers ---------- */

const parse = (text, fallback = null) => {
  try {
    return text ? JSON.parse(text) : fallback;
  } catch {
    return fallback;
  }
};
const ms = (iso) => {
  const t = Date.parse(iso || "");
  return Number.isFinite(t) ? t : NaN;
};
const utcDay = (t) => new Date(t).toISOString().slice(0, 10);
const isLinked = (d) => d.owner_id != null && (d.status === "claimed" || d.status === "active");
const round6 = (n) => Math.round(n * 1e6) / 1e6;

/** Does a timestamp fall inside a window: today is the UTC day, 7d and 30d are rolling. */
function inWindow(iso, win, now) {
  const t = typeof iso === "number" ? iso : ms(iso);
  if (!Number.isFinite(t)) return false;
  if (win === "today") return utcDay(t) === utcDay(now);
  return now - t <= WINDOWS[win] * DAY_MS;
}

/** Stripe session ids say which mode they were made in. */
function stripeMode(checkoutId) {
  const id = String(checkoutId || "");
  if (id.startsWith("cs_live_")) return "live";
  if (id.startsWith("cs_test_")) return "test";
  return "stub";
}

function paymentsMode(env) {
  const key = String(env.STRIPE_SECRET_KEY || "");
  if (/^(sk|rk)_live_/.test(key)) return "live";
  if (/^(sk|rk)_test_/.test(key)) return "test";
  return "off";
}

function subActive(sub, now) {
  return Boolean(sub && sub.status === "active" && ms(sub.period_end) >= now);
}

/** How each user has Coach: "paid", "beta", "comp" or null. Same order as coachAccess (src/coach-access.js). */
function coachAccessBy(env, userRows, deviceRows, subs, now) {
  const betaOwners = betaActive(env) ? betaOwnerIds(deviceRows, betaLinkCap(env)) : new Set();
  const subBy = new Map(subs.map((s) => [Number(s.user_id), s]));
  const out = new Map();
  for (const u of userRows) {
    const id = Number(u.id);
    const via = subActive(subBy.get(id), now) ? "paid" : betaOwners.has(id) ? "beta" : isCoachBetaUser(env, { id }) ? "comp" : null;
    out.set(id, via);
  }
  return out;
}

/* ---------- overview ---------- */

async function overview(env, { now }) {
  const { db } = env;
  const [userRows, deviceRows, subs, checkouts, linked] = await Promise.all([
    db.all(ADMIN_SQL.users),
    db.all(ADMIN_SQL.devices),
    db.all(ADMIN_SQL.coachSubs),
    db.all(ADMIN_SQL.checkouts),
    countLinkedDevices(db),
  ]);
  const paid = checkouts.filter((c) => c.status === "paid");
  const cap = betaLinkCap(env);
  const vias = [...coachAccessBy(env, userRows, deviceRows, subs, now).values()];
  const countVia = (v) => vias.filter((x) => x === v).length;
  return {
    generated_at: new Date(now).toISOString(),
    users: {
      total: userRows.length,
      new_24h: userRows.filter((u) => now - ms(u.created_at) <= DAY_MS).length,
      new_7d: userRows.filter((u) => now - ms(u.created_at) <= 7 * DAY_MS).length,
    },
    chambers: {
      linked,
      seen_24h: deviceRows.filter((d) => isLinked(d) && now - ms(d.last_seen_at) <= DAY_MS).length,
      online: deviceRows.filter((d) => isLinked(d) && deviceIsOnline(d, now)).length,
      total_rows: deviceRows.length,
    },
    beta_cap: { used: linked, cap, left: Math.max(0, cap - linked) },
    subscriptions: { active: subs.filter((s) => subActive(s, now)).length, total: subs.length },
    coach_access: { beta_active: betaActive(env), beta: countVia("beta"), paid: countVia("paid"), comp: countVia("comp") },
    profile_purchases: { paid: paid.filter((c) => c.item_id !== COACH_ITEM).length },
    payments_mode: paymentsMode(env),
  };
}

/* ---------- users ---------- */

async function users(env, { now }) {
  const { db } = env;
  const [userRows, sessions, deviceRows, subs, ents, checkouts] = await Promise.all([
    db.all(ADMIN_SQL.users),
    db.all(ADMIN_SQL.lastSessions),
    db.all(ADMIN_SQL.devices),
    db.all(ADMIN_SQL.coachSubs),
    db.all(ADMIN_SQL.entitlements),
    db.all(ADMIN_SQL.checkouts),
  ]);
  const lastLogin = new Map(sessions.map((s) => [Number(s.user_id), s.last_at]));
  const accessBy = coachAccessBy(env, userRows, deviceRows, subs, now);
  const subBy = new Map(subs.map((s) => [Number(s.user_id), s]));
  const planBy = new Map();
  for (const c of checkouts) {
    if (c.item_id !== COACH_ITEM || c.status !== "paid" || planBy.has(Number(c.user_id))) continue;
    planBy.set(Number(c.user_id), parse(c.details, {})?.plan || "monthly");
  }
  return {
    feedback_tracked: false,
    users: userRows.map((u) => {
      const id = Number(u.id);
      const sub = subBy.get(id);
      const mine = deviceRows.filter((d) => Number(d.owner_id) === id);
      return {
        id,
        username: u.username,
        email: u.email || null,
        email_verified: Boolean(Number(u.email_verified)),
        role: u.role,
        created_at: u.created_at,
        last_login_at: lastLogin.get(id) || null,
        chambers: mine.filter(isLinked).length,
        subscription: sub
          ? { status: subActive(sub, now) ? "active" : sub.status === "active" ? "lapsed" : sub.status, period_end: sub.period_end, plan: planBy.get(id) || null }
          : null,
        coach_access: accessBy.get(id) || null,
        entitlements: ents.filter((e) => Number(e.user_id) === id).map((e) => e.item_id),
        feedback: null,
      };
    }),
  };
}

/* ---------- devices ---------- */

async function devices(env, { now }) {
  const { db } = env;
  const [userRows, deviceRows, modes] = await Promise.all([db.all(ADMIN_SQL.users), db.all(ADMIN_SQL.devices), db.all(ADMIN_SQL.deviceModes)]);
  const userBy = new Map(userRows.map((u) => [Number(u.id), u]));
  const modeBy = new Map(modes.map((m) => [m.device_id, m]));
  const out = await Promise.all(
    deviceRows.map(async (d) => {
      const owner = d.owner_id != null ? userBy.get(Number(d.owner_id)) : null;
      let info = null;
      if (owner) {
        try {
          info = await enrichDevice(db, env, owner, d, { now, coachAvailable: false });
        } catch {
          info = null;
        }
      }
      const mode = modeBy.get(d.id);
      const base = String(d.hardware_id || "").split(/[#~]/)[0];
      return {
        id: d.id,
        name: d.name,
        status: d.status,
        linked: isLinked(d),
        owner: owner ? { id: Number(owner.id), username: owner.username, email: owner.email || null } : null,
        mac_tail: base ? base.slice(-6) : null,
        device_type: d.device_type || null,
        firmware: info?.firmware || null,
        profile: info?.profile ? info.profile.name || info.profile.id : null,
        stage: info?.stage ? info.stage.name : null,
        grow_day: info?.grow?.grow_day ?? null,
        mode: !mode ? "manual" : Number(mode.paused) ? `${mode.mode} (paused)` : mode.mode,
        last_seen_at: d.last_seen_at || null,
        state: !d.last_seen_at ? "never" : deviceIsOnline(d, now) ? "online" : "offline",
        created_at: d.created_at,
      };
    })
  );
  return { devices: out };
}

/* ---------- activations ---------- */

const KIND_LABEL = {
  device_claim: "linked (claim code)",
  device_enroll: "linked (enroll)",
  device_relink_enroll: "relinked",
  device_reclaim: "reclaimed",
  device_revoke: "unlinked by owner",
  device_self_revoke: "unlinked by chamber",
};

async function activations(env) {
  const { db } = env;
  const [events, userRows] = await Promise.all([db.all(ADMIN_SQL.linkEvents), db.all(ADMIN_SQL.users)]);
  const userBy = new Map(userRows.map((u) => [Number(u.id), u]));
  const rows = events.map((e) => {
    const u = e.user_id != null ? userBy.get(Number(e.user_id)) : null;
    return {
      at: e.created_at,
      kind: e.kind,
      label: KIND_LABEL[e.kind] || e.kind,
      device_id: String(e.detail || "").split(":")[0] || null,
      user: u ? { id: Number(u.id), username: u.username, email: u.email || null } : null,
    };
  });
  const byDay = {};
  for (const r of rows) {
    const day = String(r.at || "").slice(0, 10);
    byDay[day] ||= { day, linked: 0, unlinked: 0 };
    if (r.kind.includes("revoke")) byDay[day].unlinked += 1;
    else byDay[day].linked += 1;
  }
  rows.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return { events: rows, by_day: Object.values(byDay).sort((a, b) => b.day.localeCompare(a.day)) };
}

/* ---------- spend ---------- */

/**
 * Jev calls per device per UTC day. The coach_cache counter counts every call (including ones that
 * changed nothing) but only lives about two days. Older days come from coach_autopilot_log, which only
 * has decisions that changed something, so those days are a lower bound.
 */
function jevByDeviceDay(counters, logRows, deviceOwner) {
  const cells = new Map();
  for (const c of counters) {
    const m = String(c.cache_key).match(/^jev:device:(.+):(\d{4}-\d{2}-\d{2})$/);
    if (!m) continue;
    const v = parse(c.value, {}) || {};
    cells.set(`${m[1]}|${m[2]}`, { device_id: m[1], day: m[2], calls: Number(v.calls) || 0, tokens: Number(v.tokens) || 0, source: "counter" });
  }
  const fromLog = new Map();
  for (const r of logRows) {
    const audit = parse(r.readings, {})?.decider;
    if (audit?.decider !== "jev") continue;
    const day = String(r.created_at).slice(0, 10);
    const key = `${r.device_id}|${day}`;
    const cell = fromLog.get(key) || { device_id: r.device_id, day, calls: 0, tokens: 0, source: "log", user_id: Number(r.user_id) };
    cell.calls += 1;
    cell.tokens += Number(audit.usage?.input_tokens) || 0;
    fromLog.set(key, cell);
  }
  for (const [key, cell] of fromLog) if (!cells.has(key)) cells.set(key, cell);
  for (const cell of cells.values()) {
    cell.user_id ??= deviceOwner.get(cell.device_id) ?? null;
    cell.cost = round6(cell.tokens > 0 ? jevCost(cell.tokens) : cell.calls * JEV_COST_PER_DECISION);
  }
  return [...cells.values()];
}

const emptyTotals = () => Object.fromEntries(Object.keys(WINDOWS).map((w) => [w, 0]));

async function spend(env, { now }) {
  const { db } = env;
  const cutoff = new Date(now - 31 * DAY_MS).toISOString();
  const [userRows, deviceRows, counters, logRows, usage, alertMails, magic, caps, checkouts] = await Promise.all([
    db.all(ADMIN_SQL.users),
    db.all(ADMIN_SQL.devices),
    db.all(ADMIN_SQL.jevCounters),
    db.all(ADMIN_SQL.autopilotLog, [cutoff]),
    db.all(ADMIN_SQL.coachUsage, [cutoff.slice(0, 10)]),
    db.all(ADMIN_SQL.alertEmails, [cutoff]),
    db.all(ADMIN_SQL.magicLinks, [cutoff]),
    db.all(ADMIN_SQL.emailCaps),
    db.all(ADMIN_SQL.checkouts),
  ]);
  const deviceOwner = new Map(deviceRows.map((d) => [d.id, d.owner_id != null ? Number(d.owner_id) : null]));
  const deviceName = new Map(deviceRows.map((d) => [d.id, d.name]));
  const userByEmail = new Map(userRows.filter((u) => u.email).map((u) => [String(u.email).toLowerCase(), Number(u.id)]));
  const jev = jevByDeviceDay(counters, logRows, deviceOwner);
  const dayAt = (day) => Date.parse(`${day}T12:00:00Z`);

  const per = new Map();
  const row = (id) => {
    if (!per.has(id)) {
      per.set(id, {
        user_id: id,
        jev_calls: emptyTotals(),
        jev_cost: emptyTotals(),
        coach_ai_cost: emptyTotals(),
        emails: emptyTotals(),
        revenue_cents: emptyTotals(),
        revenue_test_cents: emptyTotals(),
      });
    }
    return per.get(id);
  };
  const add = (id, field, at, amount) => {
    for (const w of Object.keys(WINDOWS)) if (inWindow(at, w, now)) row(id)[field][w] += amount;
  };

  const perChamber = new Map();
  for (const c of jev) {
    // A counter row from today counts as today; the day midpoint stands in for older days.
    const at = c.day === utcDay(now) ? now : dayAt(c.day);
    add(c.user_id, "jev_calls", at, c.calls);
    add(c.user_id, "jev_cost", at, c.cost);
    const ch = perChamber.get(c.device_id) || {
      device_id: c.device_id,
      name: deviceName.get(c.device_id) || null,
      user_id: c.user_id,
      jev_calls: emptyTotals(),
      jev_cost: emptyTotals(),
      lower_bound_days: emptyTotals(),
    };
    for (const w of Object.keys(WINDOWS)) {
      if (!inWindow(at, w, now)) continue;
      ch.jev_calls[w] += c.calls;
      ch.jev_cost[w] += c.cost;
      if (c.source === "log") ch.lower_bound_days[w] += 1;
    }
    perChamber.set(c.device_id, ch);
  }
  for (const u of usage) add(Number(u.user_id), "coach_ai_cost", dayAt(u.day), ((Number(u.neurons) || 0) / 1000) * NEURON_COST_PER_K);
  for (const a of alertMails) add(Number(a.user_id), "emails", a.created_at, 1);
  for (const m of magic) {
    const id = userByEmail.get(String(m.email || "").toLowerCase());
    add(id ?? null, "emails", m.created_at, 1);
  }
  for (const c of checkouts) {
    if (c.status !== "paid") continue;
    const field = stripeMode(c.id) === "live" ? "revenue_cents" : "revenue_test_cents";
    add(Number(c.user_id), field, c.created_at, Number(c.amount_cents) || 0);
  }

  const userBy = new Map(userRows.map((u) => [Number(u.id), u]));
  const rows = [...per.values()].map((r) => {
    const u = r.user_id != null ? userBy.get(r.user_id) : null;
    const cost = emptyTotals();
    const net = emptyTotals();
    for (const w of Object.keys(WINDOWS)) {
      r.jev_cost[w] = round6(r.jev_cost[w]);
      r.coach_ai_cost[w] = round6(r.coach_ai_cost[w]);
      cost[w] = round6(r.jev_cost[w] + r.coach_ai_cost[w]);
      net[w] = round6((r.revenue_cents[w] + r.revenue_test_cents[w]) / 100 - cost[w]);
    }
    return { ...r, username: u?.username || (r.user_id == null ? "(no account)" : `#${r.user_id}`), email: u?.email || null, cost, net_incl_test: net };
  });
  const totals = { cost: emptyTotals(), jev_calls: emptyTotals(), emails: emptyTotals(), revenue_cents: emptyTotals(), revenue_test_cents: emptyTotals() };
  for (const r of rows) {
    for (const w of Object.keys(WINDOWS)) {
      totals.cost[w] = round6(totals.cost[w] + r.cost[w]);
      totals.jev_calls[w] += r.jev_calls[w];
      totals.emails[w] += r.emails[w];
      totals.revenue_cents[w] += r.revenue_cents[w];
      totals.revenue_test_cents[w] += r.revenue_test_cents[w];
    }
  }
  const today = utcDay(now);
  const capCount = (kind) => Number(caps.find((c) => c.key === `email-cap:${kind}:${today}`)?.count) || 0;
  for (const ch of perChamber.values()) for (const w of Object.keys(WINDOWS)) ch.jev_cost[w] = round6(ch.jev_cost[w]);
  return {
    payments_mode: paymentsMode(env),
    rates: { jev_per_decision: JEV_COST_PER_DECISION, jev_per_m_input_tokens: round6(jevCost(1e6)), neurons_per_k: NEURON_COST_PER_K },
    notes: {
      jev: "Today and yesterday count every Jev call. Older days count only decisions that changed a setting, so they are a lower bound.",
      emails: "Alert emails and sign-in links per user. Other sends (Autopilot pause notices, account notices) are in the all-sends total for today only.",
      revenue: "First payments from checkouts. Subscription renewals are not tracked yet.",
    },
    emails_sent_today_all: capCount("all"),
    totals,
    users: rows.sort((a, b) => b.cost["30d"] - a.cost["30d"] || (b.user_id || 0) - (a.user_id || 0)),
    chambers: [...perChamber.values()].sort((a, b) => b.jev_calls["30d"] - a.jev_calls["30d"]),
  };
}
