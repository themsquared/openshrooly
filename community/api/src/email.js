/** Cheap email interface. Resend in production; stub until keys exist. */

export async function sendEmail(env, { to, subject, text, html }) {
  const key = env.RESEND_API_KEY || env.EMAIL_API_KEY;
  const from = env.EMAIL_FROM || "Shroom Labs <noreply@shroomlabs.io>";
  if (key) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, text, html: html || text }),
    });
    if (!res.ok) throw new Error("email provider rejected the message");
    return { ok: true, provider: "resend" };
  }
  return {
    ok: true,
    provider: "stub",
    debug: String(env.AUTH_DEBUG || "") === "1" ? { to, subject, text } : undefined,
  };
}
