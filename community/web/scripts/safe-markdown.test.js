import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { escapeHtml, renderSafeMarkdown, safeDisplay } from "../public/js/safe-markdown.js";

test("safeDisplay escapes numeric and string fleet fields", () => {
  assert.equal(safeDisplay(22.5), "22.5");
  assert.equal(safeDisplay(null, "?"), "?");
  assert.equal(safeDisplay(`<img src=x onerror="alert(1)">`), `&lt;img src=x onerror=&quot;alert(1)&quot;&gt;`);
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../public/js/app.js"), "utf8");
  assert.match(src, /safeDisplay\(d\.reading\.temperature/);
  assert.match(src, /safeDisplay\(d\.setpoints\?\.temperature_c/);
  assert.doesNotMatch(src, /\$\{d\.reading\.temperature \?\?/);
});

test("escapeHtml encodes tags before any markdown runs", () => {
  assert.equal(escapeHtml(`<img src=x onerror="alert(1)">`), `&lt;img src=x onerror=&quot;alert(1)&quot;&gt;`);
  const html = renderSafeMarkdown(`<script>alert(1)</script> and **bold**`);
  assert.doesNotMatch(html, /<script/i);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /<strong>bold<\/strong>/);
});

test("renderSafeMarkdown supports bold, bullets, and line breaks", () => {
  assert.equal(renderSafeMarkdown("Keep **humidity** up"), "Keep <strong>humidity</strong> up");
  assert.equal(renderSafeMarkdown("- one\n- two"), "<ul><li>one</li><li>two</li></ul>");
  assert.equal(renderSafeMarkdown("Too warm.\nDrop the setpoint."), "Too warm.<br>Drop the setpoint.");
  assert.match(renderSafeMarkdown("* first\n* second"), /<ul><li>first<\/li><li>second<\/li><\/ul>/);
});

test("renderSafeMarkdown does not treat injected HTML as markup", () => {
  const html = renderSafeMarkdown('**ok** <b>no</b>\n- <img src=x>');
  assert.match(html, /<strong>ok<\/strong>/);
  assert.match(html, /&lt;b&gt;no&lt;\/b&gt;/);
  assert.match(html, /<li>&lt;img src=x&gt;<\/li>/);
  assert.doesNotMatch(html, /<b>/);
  assert.doesNotMatch(html, /<img/);
});
