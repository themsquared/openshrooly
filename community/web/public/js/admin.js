/** Private admin page. Every number comes from /api/admin/*, which answers 404 to anyone not on the admin list. */

import { api } from "./api.js";
import { escapeHtml } from "./safe-markdown.js";

const $ = (sel) => document.querySelector(sel);
const TZ = "America/Los_Angeles";
const state = { win: "today", q: "", sort: {}, data: null };

export function when(iso) {
  if (!iso) return "";
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "";
  return `${t.toLocaleString("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} PT`;
}

export function ago(iso, now = Date.now()) {
  const t = Date.parse(iso || "");
  if (!Number.isFinite(t)) return "never";
  const m = Math.round((now - t) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export function money(dollars) {
  const n = Number(dollars) || 0;
  if (n === 0) return "$0";
  if (Math.abs(n) < 1) return `${n < 0 ? "-" : ""}$${Math.abs(n).toFixed(4)}`;
  return `${n < 0 ? "-" : ""}$${Math.abs(n).toFixed(2)}`;
}

const cents = (c) => money((Number(c) || 0) / 100);
const pill = (text, tone = "") => `<span class="pill ${tone}">${escapeHtml(text)}</span>`;
const who = (u) => (u ? `${escapeHtml(u.email || u.username)}<br><span class="muted">#${u.id} ${escapeHtml(u.username)}</span>` : '<span class="muted">none</span>');

/**
 * A sortable table. cols: [{ key, label, num, value(row) for sorting, html(row) for display }].
 * Sorting is by the value function so dates and numbers sort as dates and numbers.
 */
function table(el, id, cols, rows, defaultSort) {
  const sort = (state.sort[id] ||= defaultSort || { key: cols[0].key, dir: 1 });
  const col = cols.find((c) => c.key === sort.key) || cols[0];
  const val = col.value || ((r) => r[col.key]);
  const sorted = [...rows].sort((a, b) => {
    const x = val(a);
    const y = val(b);
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))) * sort.dir;
  });
  const head = cols
    .map((c) => {
      const aria = c.key === sort.key ? ` aria-sort="${sort.dir > 0 ? "ascending" : "descending"}"` : "";
      return `<th scope="col"${c.num ? ' class="num"' : ""}${aria}><button type="button" data-sort="${c.key}">${escapeHtml(c.label)}</button></th>`;
    })
    .join("");
  const body = sorted.length
    ? sorted
        .map(
          (r) =>
            `<tr>${cols
              .map((c) => `<td data-label="${escapeHtml(c.label)}"${c.num ? ' class="num"' : ""}>${c.html ? c.html(r) : escapeHtml(String(r[c.key] ?? ""))}</td>`)
              .join("")}</tr>`
        )
        .join("")
    : `<tr><td colspan="${cols.length}" class="muted">Nothing yet.</td></tr>`;
  el.innerHTML = `<thead><tr>${head}</tr></thead><tbody>${body}</tbody>`;
  el.querySelectorAll("th button").forEach((b) =>
    b.addEventListener("click", () => {
      const key = b.dataset.sort;
      state.sort[id] = { key, dir: sort.key === key ? -sort.dir : 1 };
      render();
    })
  );
}

const matches = (...parts) => {
  const q = state.q.trim().toLowerCase();
  if (!q) return true;
  return parts.some((p) => String(p ?? "").toLowerCase().includes(q));
};

function stats(el, items) {
  el.innerHTML = items.map(([label, value]) => `<div class="stat"><strong>${escapeHtml(String(value))}</strong><span>${escapeHtml(label)}</span></div>`).join("");
}

function renderOverview(o) {
  stats($("#overview-stats"), [
    ["Users", o.users.total],
    ["New 24h", o.users.new_24h],
    ["New 7 days", o.users.new_7d],
    ["Linked chambers", o.chambers.linked],
    ["Seen 24h", o.chambers.seen_24h],
    ["Online now", o.chambers.online],
    ["Beta cap", `${o.beta_cap.used} / ${o.beta_cap.cap}`],
    ["Active Coach subs", o.subscriptions.active],
    ["Coach via beta", o.coach_access ? `${o.coach_access.beta}${o.coach_access.beta_active ? "" : " (beta off)"}` : "?"],
    ["Coach via payment", o.coach_access?.paid ?? "?"],
    ["Coach comp", o.coach_access?.comp ?? "?"],
    ["Paid profiles", o.profile_purchases.paid],
    ["Payments", o.payments_mode],
  ]);
}

function renderUsers(list) {
  const rows = list.filter((u) => matches(u.id, u.email, u.username, u.role));
  table($("#users-table"), "users", [
    { key: "id", label: "ID", num: true },
    { key: "email", label: "Account", value: (u) => u.email || u.username, html: (u) => who(u) },
    { key: "created_at", label: "Signed up", html: (u) => escapeHtml(when(u.created_at)) },
    { key: "last_login_at", label: "Last sign in", html: (u) => escapeHtml(u.last_login_at ? ago(u.last_login_at) : "never") },
    { key: "chambers", label: "Chambers", num: true },
    {
      key: "coach_access",
      label: "Coach access",
      value: (u) => u.coach_access || "",
      html: (u) =>
        u.coach_access
          ? pill({ paid: "paid", beta: "beta, free", comp: "comp" }[u.coach_access] || u.coach_access, u.coach_access === "paid" ? "is-ok" : "")
          : '<span class="muted">none</span>',
    },
    {
      key: "subscription",
      label: "Subscription",
      value: (u) => u.subscription?.status || "",
      html: (u) =>
        u.subscription
          ? `${pill(u.subscription.status, u.subscription.status === "active" ? "is-ok" : "is-warn")} ${escapeHtml(u.subscription.plan || "")}`
          : '<span class="muted">none</span>',
    },
    { key: "entitlements", label: "Owns", value: (u) => u.entitlements.length, html: (u) => escapeHtml(u.entitlements.join(", ") || "") },
    { key: "feedback", label: "Feedback", html: () => '<span class="muted">not tracked</span>' },
  ], rows, { key: "id", dir: -1 });
}

function renderDevices(list) {
  const rows = list.filter((d) => matches(d.id, d.name, d.mac_tail, d.owner?.email, d.owner?.username, d.profile, d.firmware));
  const tone = { online: "is-ok", offline: "is-warn", never: "" };
  table($("#devices-table"), "devices", [
    { key: "name", label: "Chamber", html: (d) => `${escapeHtml(d.name || "")}<br><span class="muted">${escapeHtml(d.id)}</span>` },
    { key: "owner", label: "Owner", value: (d) => d.owner?.email || d.owner?.username || "", html: (d) => who(d.owner) },
    { key: "mac_tail", label: "MAC tail" },
    { key: "firmware", label: "Firmware" },
    { key: "profile", label: "Profile", html: (d) => `${escapeHtml(d.profile || "")}${d.stage ? `<br><span class="muted">${escapeHtml(d.stage)}</span>` : ""}` },
    { key: "grow_day", label: "Day", num: true },
    { key: "mode", label: "Mode" },
    { key: "state", label: "Status", html: (d) => `${pill(d.state, tone[d.state])}${d.linked ? "" : ` ${pill(d.status)}`}` },
    { key: "last_seen_at", label: "Last seen", html: (d) => escapeHtml(ago(d.last_seen_at)) },
  ], rows, { key: "last_seen_at", dir: -1 });
}

function renderActivations(a) {
  const days = a.by_day.slice(0, 14).map((d) => `${d.day}: ${d.linked} linked${d.unlinked ? `, ${d.unlinked} unlinked` : ""}`);
  $("#act-days").textContent = days.length ? days.join(" · ") : "No link events yet.";
  const rows = a.events.filter((e) => matches(e.device_id, e.user?.email, e.user?.username, e.label));
  table($("#act-table"), "act", [
    { key: "at", label: "When", html: (e) => escapeHtml(when(e.at)) },
    { key: "label", label: "What" },
    { key: "device_id", label: "Chamber" },
    { key: "user", label: "Who", value: (e) => e.user?.email || "", html: (e) => who(e.user) },
  ], rows, { key: "at", dir: -1 });
}

function renderSpend(s) {
  const w = state.win;
  document.querySelectorAll("[data-win]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.win === w)));
  const t = s.totals;
  stats($("#spend-stats"), [
    ["Est. cost", money(t.cost[w])],
    ["Jev calls", t.jev_calls[w]],
    ["Emails (tracked)", t.emails[w]],
    ["Revenue live", cents(t.revenue_cents[w])],
    ["Revenue test", cents(t.revenue_test_cents[w])],
    ["Net incl. test", money((t.revenue_cents[w] + t.revenue_test_cents[w]) / 100 - t.cost[w])],
    ["All emails today", s.emails_sent_today_all],
  ]);
  const rows = s.users.filter((r) => matches(r.user_id, r.email, r.username));
  table($("#spend-table"), "spend", [
    { key: "user", label: "User", value: (r) => r.email || r.username, html: (r) => (r.user_id == null ? escapeHtml(r.username) : who({ id: r.user_id, email: r.email, username: r.username })) },
    { key: "jev_calls", label: "Jev calls", num: true, value: (r) => r.jev_calls[w], html: (r) => String(r.jev_calls[w]) },
    { key: "jev_cost", label: "Jev cost", num: true, value: (r) => r.jev_cost[w], html: (r) => money(r.jev_cost[w]) },
    { key: "coach_ai_cost", label: "Coach AI", num: true, value: (r) => r.coach_ai_cost[w], html: (r) => money(r.coach_ai_cost[w]) },
    { key: "emails", label: "Emails", num: true, value: (r) => r.emails[w], html: (r) => String(r.emails[w]) },
    { key: "revenue", label: "Revenue", num: true, value: (r) => r.revenue_cents[w], html: (r) => cents(r.revenue_cents[w]) },
    { key: "revenue_test", label: "Test rev.", num: true, value: (r) => r.revenue_test_cents[w], html: (r) => cents(r.revenue_test_cents[w]) },
    { key: "net", label: "Net", num: true, value: (r) => r.net_incl_test[w], html: (r) => money(r.net_incl_test[w]) },
  ], rows, { key: "jev_cost", dir: -1 });
  table($("#chamber-spend-table"), "chamber-spend", [
    { key: "name", label: "Chamber", html: (c) => `${escapeHtml(c.name || "")}<br><span class="muted">${escapeHtml(c.device_id)}</span>` },
    { key: "user_id", label: "Owner", num: true, html: (c) => (c.user_id == null ? "none" : `#${c.user_id}`) },
    { key: "jev_calls", label: "Jev calls", num: true, value: (c) => c.jev_calls[w], html: (c) => String(c.jev_calls[w]) },
    { key: "jev_cost", label: "Jev cost", num: true, value: (c) => c.jev_cost[w], html: (c) => money(c.jev_cost[w]) },
    { key: "lower_bound_days", label: "Days from log", num: true, value: (c) => c.lower_bound_days[w], html: (c) => String(c.lower_bound_days[w]) },
  ], s.chambers, { key: "jev_calls", dir: -1 });
  $("#spend-notes").innerHTML = [
    `Jev: $${s.rates.jev_per_decision} a decision, or $${s.rates.jev_per_m_input_tokens} per million input tokens when the tokens are logged.`,
    s.notes.jev,
    s.notes.emails,
    s.notes.revenue,
    `Payments are in ${s.payments_mode} mode.`,
  ]
    .map((n) => `<li>${escapeHtml(n)}</li>`)
    .join("");
}

const pct = (n) => (n == null ? "n/a" : `${Math.round(n * 1000) / 10}%`);

function renderFunnel(f) {
  const w = state.win;
  const live = f.live[w];
  const t = live.total;
  stats($("#funnel-stats"), [
    ["Started", t.started],
    ["Completed", t.completed],
    ["Abandoned", t.abandoned],
    ["Still open", t.open],
    ["Conversion", pct(t.conversion)],
    ["Revenue", cents(t.revenue_cents)],
  ]);
  table($("#funnel-table"), "funnel", [
    { key: "item_id", label: "Item", html: (i) => `${escapeHtml(i.item_id)}${i.plan ? ` <span class="muted">${escapeHtml(i.plan)}</span>` : ""}` },
    { key: "started", label: "Started", num: true },
    { key: "completed", label: "Completed", num: true },
    { key: "expired", label: "Expired", num: true },
    { key: "failed", label: "Failed", num: true },
    { key: "abandoned", label: "Abandoned", num: true },
    { key: "open", label: "Open", num: true },
    { key: "conversion", label: "Conversion", num: true, value: (i) => i.conversion ?? -1, html: (i) => pct(i.conversion) },
    { key: "revenue_cents", label: "Revenue", num: true, html: (i) => cents(i.revenue_cents) },
  ], live.items, { key: "started", dir: -1 });
  const test = f.test[w].total;
  $("#funnel-notes").innerHTML = [
    f.notes.abandoned,
    f.notes.conversion,
    f.notes.ga,
    `Test mode in this window: ${test.started} started, ${test.completed} completed.`,
  ]
    .map((n) => `<li>${escapeHtml(n)}</li>`)
    .join("");
}

const UNTRACKED = [
  "Feedback count per user. Feedback goes to Netlify Forms, not the database. Needs the form to also post to the API, or a feedback table.",
  "Jev calls older than two days that changed nothing. Needs a small per-day usage table (device, day, calls, tokens) kept for 30 days.",
  "Resend cost and sends other than alerts and sign-in links. Needs an email_log table (user, kind, created_at) written by sendEmail.",
  "Subscription renewal revenue. Needs the invoice.paid webhook to store amount and user in a payments table.",
  "Device firmware is shown only when the chamber has reported it in its latest readings.",
];

function render() {
  const d = state.data;
  if (!d) return;
  renderOverview(d.overview);
  renderUsers(d.users.users);
  renderDevices(d.devices.devices);
  renderActivations(d.activations);
  renderSpend(d.spend);
  renderFunnel(d.funnel);
  $("#untracked-list").innerHTML = UNTRACKED.map((n) => `<li>${escapeHtml(n)}</li>`).join("");
}

async function load() {
  const status = $("#admin-status");
  try {
    const [overview, users, devices, activations, spend, funnel] = await Promise.all(
      ["overview", "users", "devices", "activations", "spend", "funnel"].map((p) => api(`/api/admin/${p}`))
    );
    state.data = { overview, users, devices, activations, spend, funnel };
    status.textContent = `Updated ${when(overview.generated_at)}.`;
    $("#admin-body").classList.remove("hidden");
    render();
  } catch {
    status.textContent = "Page not found.";
  }
}

if (document.body?.dataset.page === "admin") {
  $("#admin-q").addEventListener("input", (e) => {
    state.q = e.target.value;
    render();
  });
  document.querySelectorAll("[data-win]").forEach((b) =>
    b.addEventListener("click", () => {
      state.win = b.dataset.win;
      render();
    })
  );
  load();
}
