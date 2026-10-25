/** Escape first, then a small markdown subset. Never inject raw HTML. */

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function safeDisplay(value, fallback = "") {
  if (value == null || value === "") return fallback;
  return escapeHtml(String(value));
}

function formatInline(line) {
  return line.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

export function renderSafeMarkdown(text) {
  const escaped = escapeHtml(text);
  const lines = escaped.split(/\r?\n/);
  const out = [];
  let list = [];
  const flushList = () => {
    if (!list.length) return;
    out.push(`<ul>${list.map((item) => `<li>${formatInline(item)}</li>`).join("")}</ul>`);
    list = [];
  };
  for (const line of lines) {
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) {
      list.push(bullet[1]);
      continue;
    }
    flushList();
    out.push(formatInline(line));
  }
  flushList();
  return out.join("<br>");
}
