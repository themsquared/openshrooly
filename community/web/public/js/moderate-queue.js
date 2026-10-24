/** Moderator queue cards. Unknown or broken items return empty so one row cannot crash the page. */

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function queueItemHtml(item, extras = {}) {
  try {
    if (!item || typeof item !== "object") return "";
    if (item.kind === "report-photo") return reportPhotoHtml(item, extras.mediaSrc || "");
    if (item.kind && item.kind !== "profile") return "";
    if (!item.profile) return "";
    return profileHtml(item, extras.thumbs || []);
  } catch {
    return "";
  }
}

function reportPhotoHtml(item, mediaSrc) {
  const rid = String(item.report_id || "");
  const profileId = String(item.profile_id || "");
  const thumb = mediaSrc
    ? `<div class="pb-photos"><img src="${escapeHtml(mediaSrc)}" alt="Grow report photo waiting for review"></div>`
    : "";
  return `<article class="card" style="padding:1.1rem">
              <p><span class="chip">Grow report photo</span></p>
              <p><a href="/profile.html?id=${escapeHtml(profileId)}">${escapeHtml(profileId)}</a></p>
              <p class="muted">${escapeHtml(item.uploader?.username || "unknown")} · ${escapeHtml(item.outcome || "")}</p>
              <p>${escapeHtml(item.notes || "")}</p>
              ${thumb}
              <label>Reason <input id="reason-report-photo-${escapeHtml(rid)}" placeholder="Required to reject"></label>
              <p class="pb-actions">
                <button type="button" data-mod="report-photo-approve" data-id="${escapeHtml(rid)}">Approve</button>
                <button type="button" class="secondary" data-mod="report-photo-reject" data-id="${escapeHtml(rid)}">Reject</button>
              </p>
            </article>`;
}

function profileHtml(item, thumbs) {
  const p = item.profile;
  const r = item.review || {};
  const thumbHtml = thumbs.length ? `<div class="pb-photos">${thumbs.join("")}</div>` : "";
  return `<article class="card" style="padding:1.1rem">
              <p><span class="chip">${escapeHtml(p.pack === "psilocybin" ? "Off-menu" : "Culinary")}</span>${r.offmenu_flag ? `<span class="chip">Off-menu flag</span>` : ""}${r.blocklist_hit ? `<span class="chip">Text flag</span>` : ""}</p>
              ${
                (r.offmenu_reasons || []).length
                  ? `<p class="notice">${(r.offmenu_reasons || []).map((reason) => escapeHtml(reason)).join(" ")}</p>`
                  : ""
              }
              <h2>${escapeHtml(r.title || p.name)}</h2>
              <p>${escapeHtml(r.description || p.summary || "")}</p>
              <p class="muted">${escapeHtml(p.species || "")}</p>
              ${
                (item.affiliate_links || []).length
                  ? `<p class="notice">Affiliate links: ${item.affiliate_links
                      .map((link) => `${escapeHtml(link.label || link.id)} (${escapeHtml(link.url || "")})`)
                      .join("; ")}</p>`
                  : ""
              }
              ${thumbHtml}
              <label>Reason <input id="reason-${escapeHtml(p.id)}" placeholder="Required to reject or ask for changes"></label>
              <p class="pb-actions">
                <button type="button" data-mod="approve" data-id="${escapeHtml(p.id)}">Approve</button>
                ${r.can_confirm_culinary ? `<button type="button" class="secondary" data-mod="confirm-culinary" data-id="${escapeHtml(p.id)}">Confirm culinary</button>` : ""}
                <button type="button" class="secondary" data-mod="request-changes" data-id="${escapeHtml(p.id)}">Ask for changes</button>
                <button type="button" class="secondary" data-mod="reject" data-id="${escapeHtml(p.id)}">Reject</button>
                <button type="button" class="secondary" data-mod="takedown" data-id="${escapeHtml(p.id)}">Take down</button>
              </p>
            </article>`;
}
