/**
 * Shared email layout for every Shroom Labs email: one column, inline styles, 16px type,
 * brand header and a footer. Plain words and no dashes in anything we write.
 */

export const BRAND = "#1f3b2d";
export const INK = "#1d2a22";
export const MUTED = "#5b6b61";
export const PAPER = "#f6f3ec";
export const FOOTER_LINE = "Works with Shrooly devices running OpenShrooly.";

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** A filled button. `href` and `label` are escaped here. */
export function button(href, label) {
  return `<p style="margin:4px 0 22px 0;"><a href="${escapeHtml(href)}" style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;padding:12px 18px;border-radius:8px;">${escapeHtml(label)}</a></p>`;
}

/** The page around an email. `bodyHtml` and `footerHtml` are trusted HTML built by the caller. */
export function layout({ title, bodyHtml, footerHtml }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:${PAPER};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER};">
<tr><td align="center" style="padding:16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<tr><td style="background:${BRAND};padding:18px 24px;color:#ffffff;font-size:20px;font-weight:700;letter-spacing:0.2px;">Shroom Labs</td></tr>
<tr><td style="padding:24px 24px 6px 24px;">
${bodyHtml}
</td></tr>
<tr><td style="padding:16px 24px 22px 24px;border-top:1px solid #e6e1d6;font-size:14px;line-height:1.5;color:${MUTED};">
<p style="margin:0 0 8px 0;">${escapeHtml(FOOTER_LINE)}</p>
${footerHtml}
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

/** The sign in (magic link) email. `minutes` is how long the link lasts. */
export function renderSignInEmail(link, minutes) {
  const subject = "Your Shroom Labs sign in link";
  const lasts = `${minutes}\u00a0minutes`;
  const p = (text, extra = "") => `<p style="margin:0 0 16px 0;font-size:16px;line-height:1.5;color:${INK};${extra}">${text}</p>`;
  const bodyHtml = [
    `<p style="margin:0 0 10px 0;font-size:20px;line-height:1.35;font-weight:700;color:${INK};">Sign in to Shroom Labs</p>`,
    p(`Use the button below to sign in. The link works once and expires in ${escapeHtml(lasts)}.`),
    button(link, "Sign in"),
    `<p style="margin:0 0 6px 0;font-size:14px;line-height:1.5;color:${MUTED};">If the button does not work, copy this link into your browser:</p>`,
    `<p style="margin:0 0 20px 0;font-size:14px;line-height:1.5;word-break:break-all;"><a href="${escapeHtml(link)}" style="color:${BRAND};">${escapeHtml(link)}</a></p>`,
  ].join("\n");
  const footerHtml = `<p style="margin:0;">You got this because someone asked to sign in with this email address. If it was not you, ignore this email and nothing will change.</p>`;
  const text = [
    "Shroom Labs",
    "",
    "Sign in to Shroom Labs",
    `Open this link to sign in. It works once and expires in ${lasts}.`,
    link,
    "",
    FOOTER_LINE,
    "If you did not ask to sign in, ignore this email and nothing will change.",
  ].join("\n");
  return { subject, html: layout({ title: subject, bodyHtml, footerHtml }), text };
}
