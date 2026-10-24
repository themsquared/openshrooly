import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveMediaUrl } from "../public/js/photo-upload.js";

test("resolveMediaUrl prefixes relative /api/media with apiBase", () => {
  assert.equal(
    resolveMediaUrl("/api/media/pending%2Freports%2Fpearl-oyster%2Fabc.jpg", "https://api.shroomlabs.io"),
    "https://api.shroomlabs.io/api/media/pending%2Freports%2Fpearl-oyster%2Fabc.jpg"
  );
  assert.equal(
    resolveMediaUrl("https://api.shroomlabs.io/api/media/abc.jpg", "https://example.com"),
    "https://api.shroomlabs.io/api/media/abc.jpg"
  );
  assert.equal(resolveMediaUrl("", "https://api.shroomlabs.io"), "");
});
