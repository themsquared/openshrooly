/** Grow Coach photo check: snap or upload a photo, pick a chamber or profile, get a plain recommendation. */

import { escapeHtml } from "./safe-markdown.js";

export const PHOTO_MAX_EDGE = 1024;
export const PHOTO_QUALITY = 0.85;
const SEVERITY = { high: "Act now", medium: "Watch", low: "Minor" };

export function chamberOptionsHtml(chambers = []) {
  const rows = chambers.map((c) => {
    const bits = [c.name || c.id];
    if (c.profile?.name) bits.push(c.profile.name);
    if (c.grow_day) bits.push(`day ${c.grow_day}`);
    return `<option value="${escapeHtml(c.id)}">${escapeHtml(bits.join(", "))}</option>`;
  });
  return `${rows.join("")}<option value="">No chamber, pick a profile</option>`;
}

export function profileOptionsHtml(profiles = []) {
  return (
    `<option value="">Not sure</option>` +
    profiles.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name || p.id)}</option>`).join("")
  );
}

export function usageText(usage) {
  if (!usage || !Number.isFinite(usage.cap)) return "";
  const left = Math.max(0, usage.cap - (usage.photos || 0));
  return `${usage.photos || 0} of ${usage.cap} photo checks used today. ${left} left.`;
}

export function renderPhotoResult(data = {}) {
  const rec = data.recommendation || {};
  if (rec.off_topic) {
    return `<div class="photo-rec"><p>${escapeHtml(rec.summary || "That photo does not look like a culinary grow. Try a clear shot of the block or the pins.")}</p></div>`;
  }
  const issues = (rec.issues || [])
    .map(
      (i) =>
        `<li class="photo-issue sev-${escapeHtml(i.severity || "low")}"><strong>${escapeHtml(i.label)}</strong> <span class="chip">${escapeHtml(SEVERITY[i.severity] || "Minor")}</span>${i.detail ? `<br><span class="muted">${escapeHtml(i.detail)}</span>` : ""}</li>`
    )
    .join("");
  const steps = (rec.next_steps || []).map((s) => `<li>${escapeHtml(s)}</li>`).join("");
  const based = data.context?.label ? `Based on ${data.context.label}${data.context.source === "chamber" ? " readings" : ""}.` : "";
  return `<div class="photo-rec">
    ${rec.stage ? `<p class="eyebrow">Looks like ${escapeHtml(rec.stage)}</p>` : ""}
    <p class="photo-summary">${escapeHtml(rec.summary || "")}</p>
    ${issues ? `<h3>What I see</h3><ul class="photo-issues">${issues}</ul>` : `<p class="muted">Nothing worrying in this photo.</p>`}
    ${steps ? `<h3>What to do next</h3><ol class="photo-steps">${steps}</ol>` : ""}
    <p class="muted">${escapeHtml(based)} Confidence ${Math.round((rec.confidence || 0) * 100)}%.</p>
  </div>`;
}

/** Wire the #coach-photo card. Returns false when photo checks are not available for this account. */
export async function mountPhotoCheck({ root, api, encodePhoto, onError = () => {} }) {
  if (!root) return false;
  let options;
  try {
    options = await api("/api/coach/photo");
  } catch {
    return false;
  }
  if (!options?.available) return false;
  const $ = (sel) => root.querySelector(sel);
  const chamber = $("#cp-chamber");
  const profileWrap = $("#cp-profile-wrap");
  const profile = $("#cp-profile");
  const file = $("#cp-file");
  const preview = $("#cp-preview");
  const result = $("#cp-result");
  const usage = $("#cp-usage");
  const button = $("#cp-submit");

  chamber.innerHTML = chamberOptionsHtml(options.chambers);
  profile.innerHTML = profileOptionsHtml(options.profiles);
  const syncProfile = () => profileWrap.classList.toggle("hidden", Boolean(chamber.value));
  chamber.addEventListener("change", syncProfile);
  syncProfile();
  usage.textContent = usageText(options.usage);

  file.addEventListener("change", () => {
    const f = file.files?.[0];
    if (preview.dataset.url) URL.revokeObjectURL(preview.dataset.url);
    if (!f) {
      preview.classList.add("hidden");
      return;
    }
    const url = URL.createObjectURL(f);
    preview.dataset.url = url;
    preview.src = url;
    preview.classList.remove("hidden");
    root.querySelector(".photo-pick span").textContent = "Change photo";
  });

  $("#cp-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const f = file.files?.[0];
    if (!f) {
      result.innerHTML = `<p class="notice">Take or choose a photo first.</p>`;
      return;
    }
    button.disabled = true;
    button.textContent = "Checking…";
    result.innerHTML = `<div class="sk sk-card" aria-hidden="true"></div>`;
    try {
      const encoded = await encodePhoto(f, { maxEdge: PHOTO_MAX_EDGE, quality: PHOTO_QUALITY });
      const data = await api("/api/coach/photo", {
        method: "POST",
        jsonBody: {
          photo_base64: encoded.photo_base64,
          photo_type: encoded.photo_type,
          device_id: chamber.value || undefined,
          profile_id: chamber.value ? undefined : profile.value || undefined,
          note: $("#cp-note").value.trim() || undefined,
        },
      });
      result.innerHTML = renderPhotoResult(data);
      usage.textContent = usageText(data.usage);
    } catch (err) {
      result.innerHTML = `<p class="notice" role="alert">${escapeHtml(err.message || "The photo check did not finish.")}</p>`;
      onError(err);
    } finally {
      button.disabled = false;
      button.textContent = "Check my grow";
    }
  });
  root.classList.remove("hidden");
  return true;
}
