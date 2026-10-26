/** Email provider. Resend when keyed; completing stub only under DEV_STUBS on a non-prod host. */

import { comingSoonBody, devStubsEnabled, emailConfigured } from "./providers.js";
import { rateLimit } from "./security.js";

/**
 * Global daily send caps (UTC day). Sign-in links can use the whole cap. Everything else
 * (grow alerts, review notices) stops at the lower one, so a loop cannot starve sign-in.
 */
export const EMAIL_DAILY_CAP = 300;
export const EMAIL_DAILY_BULK_CAP = 200;

function envInt(env, name, fallback) {
  const n = Number.parseInt(String(env?.[name] ?? ""), 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function emailCaps(env = {}) {
  const total = envInt(env, "EMAIL_DAILY_CAP", EMAIL_DAILY_CAP);
  return { total, bulk: Math.min(total, envInt(env, "EMAIL_DAILY_BULK_CAP", EMAIL_DAILY_BULK_CAP)) };
}

/** Counts one send against today's caps. Returns false once a cap is reached. */
async function underDailyCap(env, priority) {
  if (!env?.db) return true;
  const caps = emailCaps(env);
  const day = new Date().toISOString().slice(0, 10);
  const window = 2 * 86400;
  if (caps.total === 0 || (priority !== "login" && caps.bulk === 0)) return false;
  if (priority !== "login" && !(await rateLimit(env.db, `email-cap:bulk:${day}`, caps.bulk, window)).ok) return false;
  return (await rateLimit(env.db, `email-cap:all:${day}`, caps.total, window)).ok;
}

export async function sendEmail(env, { to, subject, text, html, headers, priority = "bulk" }, request) {
  const from = env.EMAIL_FROM || "Shroom Labs <noreply@shroomlabs.io>";
  if (emailConfigured(env)) {
    if (!(await underDailyCap(env, priority))) {
      console.error(JSON.stringify({ level: "error", event: "email_daily_cap", priority }));
      return { ok: false, provider: "capped", capped: true, error: "We are sending a lot of email right now. Try again in a few hours." };
    }
    const key = env.RESEND_API_KEY || env.EMAIL_API_KEY;
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, text, ...(html ? { html } : {}), ...(headers ? { headers } : {}) }),
    });
    if (!res.ok) throw new Error("email provider rejected the message");
    return { ok: true, provider: "resend" };
  }
  if (devStubsEnabled(env, request)) {
    return {
      ok: true,
      provider: "stub",
      debug: { to, subject, text },
    };
  }
  return { ok: false, provider: "disabled", ...comingSoonBody("Email") };
}
