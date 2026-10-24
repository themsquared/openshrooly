/**
 * Delivery channels. Email goes through sendEmail (Resend) only when a provider key is set;
 * otherwise the stub records the alert in app and logs a line without the address.
 * Push is a named slot for later and is not wired.
 */

import { sendEmail } from "../email.js";
import { emailConfigured } from "../providers.js";

export const CHANNELS = {
  email: {
    name: "email",
    configured: (env) => emailConfigured(env),
    /** Returns the final alert status: sent, stub, or failed. */
    async deliver(env, { to, message, alertIds, rule, kind }) {
      if (!emailConfigured(env)) {
        console.log(JSON.stringify({ level: "info", event: "alert_email_stub", alert_ids: alertIds, rule, kind }));
        return "stub";
      }
      try {
        const res = await sendEmail(env, { to, ...message });
        return res?.ok ? "sent" : "failed";
      } catch {
        console.log(JSON.stringify({ level: "warn", event: "alert_email_failed", alert_ids: alertIds, rule, kind }));
        return "failed";
      }
    },
  },
  push: {
    name: "push",
    configured: () => false,
    async deliver() {
      throw new Error("push alerts are not wired yet");
    },
  },
};

export function channelStatus(env) {
  return { email: emailConfigured(env) ? "live" : "stub", push: "not available" };
}
