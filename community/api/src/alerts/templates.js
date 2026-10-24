/**
 * Alert copy and email templates. Plain words, no dashes in anything we write, one column,
 * inline styles, 16px type, so it reads well on a phone. Every email carries the unsubscribe link
 * in the body and in the List-Unsubscribe headers.
 */

const BRAND = "#1f3b2d";
const INK = "#1d2a22";
const MUTED = "#5b6b61";
const PAPER = "#f6f3ec";
export const FOOTER_LINE = "Works with Shrooly devices running OpenShrooly.";

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const f = (c) => Math.round((c * 9) / 5 + 32);
const one = (n) => (Math.round(n * 10) / 10).toString();

function tempText(c) {
  return `${one(c)} °C (${f(c)} °F)`;
}

function tempRange(range) {
  return `${one(range.min)} to ${one(range.max)} °C (${f(range.min)} to ${f(range.max)} °F)`;
}

export function duration(minutes) {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"}`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  const hours = `${h} hour${h === 1 ? "" : "s"}`;
  return rest ? `${hours} ${rest} minute${rest === 1 ? "" : "s"}` : hours;
}

function chamber(name) {
  const text = String(name || "").trim();
  return text || "Your chamber";
}

/** Title and detail for one notice. `cond` is the evaluator output, `now` epoch ms. */
export function alertCopy(kind, cond, { deviceName, now, stage }) {
  const name = chamber(deviceName);
  const heldMin = cond?.since ? (now - Date.parse(cond.since)) / 60000 : 0;
  const stageText = stage?.name ? ` during ${stage.name.toLowerCase()}` : "";
  switch (`${cond.rule}:${kind}`) {
    case "temperature:open":
      return {
        title: `${name}: temperature is too ${cond.direction === "low" ? "low" : "high"}`,
        detail: `It has read ${tempText(cond.value)} for ${duration(heldMin)}. The target${stageText} is ${tempRange(cond.range)}.`,
      };
    case "temperature:recovered":
      return {
        title: `${name}: temperature is back in range`,
        detail: `It now reads ${tempText(cond.value)}, inside the ${tempRange(cond.range)} target.`,
      };
    case "humidity:open":
      return {
        title: `${name}: humidity is too ${cond.direction === "low" ? "low" : "high"}`,
        detail: `It has read ${one(cond.value)}% for ${duration(heldMin)}. The target${stageText} is ${one(cond.range.min)}% to ${one(cond.range.max)}%.`,
      };
    case "humidity:recovered":
      return {
        title: `${name}: humidity is back in range`,
        detail: `It now reads ${one(cond.value)}%, inside the ${one(cond.range.min)}% to ${one(cond.range.max)}% target.`,
      };
    case "water:open":
      return {
        title: `${name}: water is low`,
        detail: `The water tank reads ${one(cond.value)}%. Top it up with clean water so the humidifier keeps running.`,
      };
    case "water:recovered":
      return {
        title: `${name}: water is topped up`,
        detail: `The water tank now reads ${one(cond.value)}%.`,
      };
    case "offline:open":
      return {
        title: `${name}: chamber is offline`,
        detail: `We have not heard from it for ${duration(cond.value)}. Check that it has power and WiFi.`,
      };
    case "offline:recovered":
      return {
        title: `${name}: chamber is back online`,
        detail: "It is reporting again.",
      };
    case "fruiting:milestone":
      return {
        title: `${name}: fruiting day is here`,
        detail: `Today is day ${cond.value} of your ${cond.profile_name || "tracked"} grow, the first day of the fruiting stage. Open the profile for the fruiting targets.`,
      };
    default:
      return { title: `${name}: chamber alert`, detail: "Open Shroom Labs for details." };
  }
}

export const TEST_COPY = {
  title: "Test alert from Shroom Labs",
  detail: "This is a test. Alert emails are set up for your account.",
};

/**
 * Render one email for one or more alert rows (several when quiet hours held them).
 * links: { settings, unsubscribePage, unsubscribePost }.
 */
export function renderEmail(alerts, links) {
  const list = alerts.filter(Boolean);
  const many = list.length > 1;
  const subject = many ? `${list.length} chamber alerts while quiet hours were on` : list[0].title;
  const intro = many ? "These came in during your quiet hours." : "";
  const itemsHtml = list
    .map(
      (a) => `<tr><td style="padding:0 0 18px 0;">
<p style="margin:0 0 6px 0;font-size:18px;line-height:1.35;font-weight:700;color:${INK};">${escapeHtml(a.title)}</p>
<p style="margin:0;font-size:16px;line-height:1.5;color:${INK};">${escapeHtml(a.detail)}</p>
</td></tr>`
    )
    .join("\n");
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:${PAPER};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER};">
<tr><td align="center" style="padding:16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<tr><td style="background:${BRAND};padding:18px 24px;color:#ffffff;font-size:20px;font-weight:700;letter-spacing:0.2px;">Shroom Labs</td></tr>
<tr><td style="padding:24px 24px 6px 24px;">
${intro ? `<p style="margin:0 0 16px 0;font-size:16px;line-height:1.5;color:${MUTED};">${escapeHtml(intro)}</p>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${itemsHtml}
</table>
<p style="margin:4px 0 22px 0;"><a href="${escapeHtml(links.settings)}" style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;padding:12px 18px;border-radius:8px;">Open alert settings</a></p>
</td></tr>
<tr><td style="padding:16px 24px 22px 24px;border-top:1px solid #e6e1d6;font-size:14px;line-height:1.5;color:${MUTED};">
<p style="margin:0 0 8px 0;">${escapeHtml(FOOTER_LINE)}</p>
<p style="margin:0;">You get these because alert emails are on for your account. <a href="${escapeHtml(links.settings)}" style="color:${BRAND};">Change alert settings</a> or <a href="${escapeHtml(links.unsubscribePage)}" style="color:${BRAND};">unsubscribe from alert emails</a>.</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
  const text = [
    "Shroom Labs",
    "",
    ...(intro ? [intro, ""] : []),
    ...list.flatMap((a) => [a.title, a.detail, ""]),
    `Alert settings: ${links.settings}`,
    "",
    FOOTER_LINE,
    `Unsubscribe from alert emails: ${links.unsubscribePage}`,
  ].join("\n");
  const headers = {
    "List-Unsubscribe": `<${links.unsubscribePost}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
  return { subject, html, text, headers };
}
