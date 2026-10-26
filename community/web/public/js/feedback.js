/* Beta feedback: a Netlify form for signed-in testers with a linked chamber.
   The gate is client side on purpose. Netlify stores and emails the submission. */

export const FEEDBACK_TYPES = { bug: "bug", confusing: "confusing", idea: "idea" };
export const SCREENSHOT_MAX_BYTES = 5 * 1024 * 1024;

export function linkedDevices(list) {
  return (Array.isArray(list) ? list : []).filter((d) => d && d.id && d.status !== "revoked");
}

/** Email subject Mike filters on. Unknown types fall back to "other". */
export function feedbackSubject(type) {
  return `Shroom Labs feedback: ${FEEDBACK_TYPES[type] || "other"}`;
}

export function deviceFirmware(device) {
  return String(device?.capabilities?.firmware || device?.firmware || "").slice(0, 64);
}

export function screenshotProblem(file) {
  if (!file || !file.size) return "";
  if (!String(file.type || "").startsWith("image/")) return "The screenshot needs to be an image.";
  if (file.size > SCREENSHOT_MAX_BYTES) return "That screenshot is over 5 MB. Try a smaller one, or send it without.";
  return "";
}

export function deviceOptions(devices, selectedId = "") {
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const opts = devices.map((d) => `<option value="${esc(d.id)}"${d.id === selectedId ? " selected" : ""}>${esc(d.name || d.id)}</option>`);
  if (devices.length > 1) opts.push(`<option value="">Not about one chamber</option>`);
  return opts.join("");
}

/** Fill the hidden fields right before sending. */
export function fillHidden(form, { me, device, href, userAgent }) {
  const set = (name, value) => {
    const el = form.elements.namedItem(name);
    if (el) el.value = String(value ?? "").slice(0, 300);
  };
  const type = form.elements.namedItem("type")?.value || "";
  set("subject", feedbackSubject(type));
  // /api/me answers { user: { id, username } }.
  const user = me?.user || me;
  set("user_id", user?.id);
  set("username", user?.username);
  set("device_id", device?.id || "");
  set("firmware", deviceFirmware(device));
  set("page_url", href);
  set("browser", userAgent);
}
