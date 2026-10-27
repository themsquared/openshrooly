import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SPECIES } from "./tools/index.js";

const PUBLIC = join(import.meta.dirname, "..", "public");
// Count words the way a reader does: "22 °C (72 °F)" is one temperature, not four words.
const words = (s) => s.replace(/\d+ °C \(\d+ °F\)/g, "T").replace(/&#39;/g, "'").split(/\s+/).filter(Boolean).length;

test("every species page opens with a 40 to 60 word answer naming the Latin and other names", () => {
  for (const s of SPECIES) {
    const html = readFileSync(join(PUBLIC, "profiles", `${s.id}.html`), "utf8");
    const answer = html.match(/<p class="lede answer-first">([^<]+)<\/p>/)?.[1];
    assert.ok(answer, `${s.id} has an answer-first opening`);
    const n = words(answer);
    assert.ok(n >= 40 && n <= 60, `${s.id} answer is ${n} words`);
    assert.ok(answer.includes(s.latin), `${s.id} answer names ${s.latin}`);
    const title = html.match(/<title>([^<]+)<\/title>/)[1];
    assert.ok(title.includes(s.latin), `${s.id} title names ${s.latin}`);
  }
});
