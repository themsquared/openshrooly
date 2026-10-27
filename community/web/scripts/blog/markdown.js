/**
 * Small markdown subset for blog posts. No raw HTML passes through: every text run is escaped.
 * Supports ## and ### headings, paragraphs, - and 1. lists, pipe tables, > notes,
 * **bold**, _italic_, `code` and [label](href) links.
 */

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Front matter between --- lines. Values are strings; "key:" followed by "  - item" lines makes a list. */
export function parseFrontMatter(text) {
  const src = String(text).replace(/\r\n/g, "\n");
  if (!src.startsWith("---\n")) throw new Error("post must start with --- front matter");
  const end = src.indexOf("\n---\n", 4);
  if (end < 0) throw new Error("front matter is not closed with ---");
  const data = {};
  let listKey = "";
  for (const raw of src.slice(4, end).split("\n")) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    const item = raw.match(/^\s+-\s+(.*)$/);
    if (item && listKey) {
      data[listKey].push(item[1].trim());
      continue;
    }
    const kv = raw.match(/^([a-z][a-z0-9_]*):\s*(.*)$/);
    if (!kv) throw new Error(`bad front matter line: ${raw}`);
    const [, key, value] = kv;
    if (value === "") {
      data[key] = [];
      listKey = key;
    } else {
      data[key] = value.trim();
      listKey = "";
    }
  }
  return { data, body: src.slice(end + 5) };
}

/**
 * Inline markdown. linkFor(href) returns the href to use, or "" to render the label as plain text
 * (used for internal pages that do not exist yet).
 */
export function inline(text, linkFor = (h) => h) {
  const parts = [];
  const re = /\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  for (const m of String(text).matchAll(re)) {
    parts.push(styled(text.slice(last, m.index)));
    const href = linkFor(m[2]);
    const label = styled(m[1]);
    const external = /^https?:\/\//.test(m[2]);
    parts.push(href ? `<a href="${escapeHtml(href)}"${external ? ' rel="noopener"' : ""}>${label}</a>` : label);
    last = m.index + m[0].length;
  }
  parts.push(styled(text.slice(last)));
  return parts.join("");
}

function styled(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])_([^_]+)_(?=[\s.,;:)!?]|$)/g, "$1<em>$2</em>");
}

export function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Parse a markdown body into blocks: { type: "h2"|"h3"|"p"|"ul"|"ol"|"table"|"note", text|items|rows }.
 * Blocks keep the raw markdown so the caller can render HTML, plain text, or JSON-LD from them.
 */
export function parseBlocks(body) {
  const lines = String(body).replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let i = 0;
  const isListItem = (l, ordered) => (ordered ? /^\d+\.\s+/.test(l) : /^-\s+/.test(l));
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const h = line.match(/^(#{2,3})\s+(.*)$/);
    if (h) {
      blocks.push({ type: h[1].length === 2 ? "h2" : "h3", text: h[2].trim() });
      i++;
      continue;
    }
    if (/^#\s/.test(line)) throw new Error("use ## or ### headings; the title is the page h1");
    const ordered = isListItem(line, true);
    if (ordered || isListItem(line, false)) {
      const items = [];
      while (i < lines.length && isListItem(lines[i], ordered)) {
        let item = lines[i].replace(ordered ? /^\d+\.\s+/ : /^-\s+/, "");
        i++;
        while (i < lines.length && /^\s{2,}\S/.test(lines[i])) item += ` ${lines[i++].trim()}`;
        items.push(item.trim());
      }
      blocks.push({ type: ordered ? "ol" : "ul", items });
      continue;
    }
    if (/^\|/.test(line)) {
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) {
        const cells = lines[i].trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-{3,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      blocks.push({ type: "table", rows });
      continue;
    }
    if (/^>\s?/.test(line)) {
      const text = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) text.push(lines[i++].replace(/^>\s?/, ""));
      blocks.push({ type: "note", text: text.join(" ").trim() });
      continue;
    }
    const text = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|-\s|\d+\.\s|\||>)/.test(lines[i])) text.push(lines[i++].trim());
    blocks.push({ type: "p", text: text.join(" ") });
  }
  return blocks;
}

export function blocksToHtml(blocks, linkFor) {
  const il = (t) => inline(t, linkFor);
  return blocks
    .map((b) => {
      if (b.type === "h2") return `<h2 id="${slugify(b.text)}">${il(b.text)}</h2>`;
      if (b.type === "h3") return `<h3>${il(b.text)}</h3>`;
      if (b.type === "p") return `<p>${il(b.text)}</p>`;
      if (b.type === "note") return `<p class="blog-note">${il(b.text)}</p>`;
      if (b.type === "ul" || b.type === "ol") return `<${b.type}>${b.items.map((t) => `<li>${il(t)}</li>`).join("")}</${b.type}>`;
      if (b.type === "table") {
        const [head, ...rows] = b.rows;
        return `<div class="table-wrap"><table class="conditions-table"><thead><tr>${head.map((c) => `<th scope="col">${il(c)}</th>`).join("")}</tr></thead><tbody>${rows
          .map((r) => `<tr>${r.map((c, j) => (j === 0 ? `<th scope="row">${il(c)}</th>` : `<td>${il(c)}</td>`)).join("")}</tr>`)
          .join("")}</tbody></table></div>`;
      }
      return "";
    })
    .join("\n      ");
}

/** Markdown inline text to plain text, for JSON-LD, feeds and llms.txt. */
export function plain(text) {
  return String(text)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/(^|[\s(])_([^_]+)_/g, "$1$2");
}

export function blocksToText(blocks) {
  return blocks
    .map((b) => {
      if (b.type === "h2") return `### ${plain(b.text)}`;
      if (b.type === "h3") return `#### ${plain(b.text)}`;
      if (b.type === "p" || b.type === "note") return plain(b.text);
      if (b.type === "ul") return b.items.map((t) => `- ${plain(t)}`).join("\n");
      if (b.type === "ol") return b.items.map((t, n) => `${n + 1}. ${plain(t)}`).join("\n");
      if (b.type === "table") return b.rows.map((r) => `| ${r.map(plain).join(" | ")} |`).join("\n");
      return "";
    })
    .join("\n\n");
}
