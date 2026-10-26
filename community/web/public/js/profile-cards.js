/** Library card markup. Credits inside the card <a> stay plain text. */

import { INDEXED_PROFILES } from "./indexed-profiles.js";
import { isOffMenu, packLabel } from "./pack.js";
import { speciesArt } from "./species-art.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function profileHref(id) {
  return INDEXED_PROFILES.has(id) ? `/profiles/${encodeURIComponent(id)}` : `/profile?id=${encodeURIComponent(id)}`;
}

function stageDots(stages = []) {
  if (!stages.length) return "";
  return `<ol class="mini-timeline" aria-label="Stage timeline">${stages
    .map((s, i) => `<li class="${i === 0 ? "is-on" : ""}" title="${escapeHtml(s.name || s.id)} · ${s.duration_days || 0}d"></li>`)
    .join("")}</ol>`;
}

/** One GA4 item for a profile: slug, name, category ("chef", "paid" or "free") and price. No user data. */
export function profileItem(p) {
  const paid = p?.pricing?.kind === "paid";
  return {
    item_id: String(p?.id || ""),
    item_name: String(p?.name || ""),
    item_category: paid && (p.tags || []).includes("chef") ? "chef" : paid ? "paid" : "free",
    price: paid ? Number(p.pricing.amount_cents || 0) / 100 : 0,
  };
}

/** data-sl-item for js/ga.js list and click events. Empty for Off-menu profiles, so they are never sent. */
export function analyticsItemAttr(p) {
  return isOffMenu(p) ? "" : ` data-sl-item="${escapeHtml(JSON.stringify(profileItem(p)))}"`;
}

export function renderProfileCard(p, index = 0) {
  const art = speciesArt(p.species, p.strain, p.name, p.pack, { priority: index === 0, id: p.id, linked: false });
  return `<a class="profile-card" href="${profileHref(p.id)}"${analyticsItemAttr(p)}>
      ${art ? `<div class="profile-art">${art}</div>` : ""}
      <div class="profile-body">
        <p>${
          (p.tags || []).includes("chef")
            ? `<span class="chip chip-chef">Chef's line</span>`
            : `<span class="chip">${escapeHtml(p.pack_label || packLabel(p.pack))}</span>`
        }${
          p.pricing?.kind === "paid"
            ? `<span class="price">$${(p.pricing.amount_cents / 100).toFixed(2)}</span>`
            : `<span class="chip">free</span>`
        }</p>
        <h2>${escapeHtml(p.name)}</h2>
        <p class="muted">${escapeHtml(p.species)}${p.strain ? " · " + escapeHtml(p.strain) : ""}</p>
        <p>${escapeHtml(p.summary || "")}</p>
        ${stageDots(p.stage_list || p.stages || [])}
      </div>
    </a>`;
}

export function renderProfileCards(profiles) {
  return profiles.map((p, index) => renderProfileCard(p, index)).join("");
}
