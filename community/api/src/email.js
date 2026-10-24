/** Email provider. Resend when keyed; completing stub only under DEV_STUBS on a non-prod host. */

import { comingSoonBody, devStubsEnabled, emailConfigured } from "./providers.js";

export async function sendEmail(env, { to, subject, text, html, headers }, request) {
  const from = env.EMAIL_FROM || "Shroom Labs <noreply@shroomlabs.io>";
  if (emailConfigured(env)) {
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
