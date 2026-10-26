/**
 * Who can use Grow Coach and Autopilot, and why. One place, so chat, suggest, Autopilot,
 * the decisions feed, chamber status and the admin page all agree.
 *
 * - paid: an active coach_subs row (the only record a payment writes).
 * - beta: BETA_ACTIVE is on and the user owns a linked chamber inside the beta link cap
 *   (the first BETA_LINK_CAP linked chambers, oldest first; links stop at the cap anyway).
 * - comp: user ids in COACH_BETA_USER_IDS (staff and test accounts). Not tied to BETA_ACTIVE.
 *
 * To end the beta, set BETA_ACTIVE = "0" in wrangler.deploy.toml and deploy. Beta users then
 * need a paid plan like everyone else.
 */

import { nowIso } from "./crypto.js";
import { betaLinkCap, countLinkedDevices } from "./devices.js";
import { isCoachBetaUser } from "./providers.js";

const ALL_DEVICES_SQL = "SELECT * FROM cloud_devices ORDER BY created_at";

/** Beta is on unless BETA_ACTIVE is "0", "false" or "off". Unset means on. */
export function betaActive(env = {}) {
  const raw = String(env.BETA_ACTIVE ?? "1").trim().toLowerCase();
  return !["0", "false", "off", "no"].includes(raw);
}

export const isLinkedChamber = (d) => d && d.owner_id != null && (d.status === "claimed" || d.status === "active");

const byAge = (a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")) || String(a.id).localeCompare(String(b.id));

/** Owner ids with a linked chamber among the first `cap` linked chambers, oldest first. Pure, for the admin page. */
export function betaOwnerIds(deviceRows = [], cap = 50) {
  const linked = deviceRows.filter(isLinkedChamber).sort(byAge).slice(0, Math.max(0, cap));
  return new Set(linked.map((d) => Number(d.owner_id)));
}

/** Does this user own a linked chamber inside the beta cap. Ignores BETA_ACTIVE. */
export async function hasBetaChamber(env, db, user) {
  if (!user) return false;
  const mine = ((await db.all("SELECT * FROM cloud_devices WHERE owner_id=?", [user.id])) || []).filter(isLinkedChamber);
  if (!mine.length) return false;
  const cap = betaLinkCap(env);
  // Links stop at the cap, so normally every linked chamber is a beta chamber.
  if ((await countLinkedDevices(db)) <= cap) return true;
  return betaOwnerIds((await db.all(ALL_DEVICES_SQL)) || [], cap).has(Number(user.id));
}

export async function linkedChamberCount(db, user) {
  if (!user) return 0;
  return ((await db.all("SELECT * FROM cloud_devices WHERE owner_id=?", [user.id])) || []).filter(isLinkedChamber).length;
}

export function subIsActive(sub, now = nowIso()) {
  return Boolean(sub && sub.status === "active" && sub.period_end >= now);
}

export async function hasPaidCoach(db, user) {
  if (!user) return false;
  // The subscription row is the only source of truth, so a cancel takes access away.
  return subIsActive(await db.one("SELECT * FROM coach_subs WHERE user_id=?", [user.id]));
}

/**
 * { entitled, via, paid, beta, comp }. `via` is "paid", "beta", "comp" or null; paid wins when
 * several apply, so a paying beta user keeps access when the beta ends. Ignores the kill switch.
 */
export async function coachAccess(env, db, user) {
  if (!user) return { entitled: false, via: null, paid: false, beta: false, comp: false };
  const paid = await hasPaidCoach(db, user);
  const comp = isCoachBetaUser(env, user);
  const beta = betaActive(env) && (await hasBetaChamber(env, db, user));
  const via = paid ? "paid" : beta ? "beta" : comp ? "comp" : null;
  return { entitled: Boolean(via), via, paid, beta, comp };
}
