import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  encodePhotoForUpload,
  fetchAuthedImageUrl,
  resolveMediaUrl,
  revokeTrackedBlobUrls,
  trackBlobUrl,
} from "../public/js/photo-upload.js";

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

test("fetchAuthedImageUrl sends the auth header and returns a blob URL", async () => {
  const calls = [];
  const src = await fetchAuthedImageUrl("/api/media/pending%2Freports%2Fa.jpg", {
    apiBase: "https://api.shroomlabs.io",
    token: "mod-token",
    fetchImpl: async (url, opts) => {
      calls.push({ url, opts });
      return {
        ok: true,
        blob: async () => new Blob(["jpeg"], { type: "image/jpeg" }),
      };
    },
    createObjectURL: () => "blob:https://shroomlabs.io/thumb",
  });
  assert.equal(src, "blob:https://shroomlabs.io/thumb");
  assert.equal(calls[0].url, "https://api.shroomlabs.io/api/media/pending%2Freports%2Fa.jpg");
  assert.equal(calls[0].opts.headers.authorization, "Bearer mod-token");
  assert.equal(calls[0].opts.headers.accept, "image/*");
});

test("revokeTrackedBlobUrls drops replaced thumbs", () => {
  revokeTrackedBlobUrls(() => {});
  const revoked = [];
  trackBlobUrl("blob:https://shroomlabs.io/one");
  trackBlobUrl("blob:https://shroomlabs.io/two");
  revokeTrackedBlobUrls((url) => revoked.push(url));
  assert.deepEqual(revoked, ["blob:https://shroomlabs.io/one", "blob:https://shroomlabs.io/two"]);
  revokeTrackedBlobUrls((url) => revoked.push(url));
  assert.equal(revoked.length, 2);
});

test("profile and moderate pages revoke blob thumbs and do not use a dead pending href", async () => {
  const { readFileSync } = await import("node:fs");
  const app = readFileSync(new URL("../public/js/app.js", import.meta.url), "utf8");
  assert.match(app, /revokeTrackedBlobUrls/);
  assert.match(app, /pagehide/);
  assert.match(app, /photo_status === "pending"/);
  assert.match(app, /reportPhotoUrl\(r\.photo_key\)/);
  assert.match(app, /Your report photo awaiting review/);
  assert.match(app, /bindBlobUrlCleanup\(\)/);
});

test("report and builder photos stay inside the column on phones", () => {
  const style = readFileSync(new URL("../public/css/style.css", import.meta.url), "utf8");
  const builder = readFileSync(new URL("../public/css/profile-builder.css", import.meta.url), "utf8");
  assert.match(style, /#reports img\s*\{[^}]*max-width:\s*100%/);
  assert.match(style, /#reports img\s*\{[^}]*height:\s*auto/);
  assert.match(builder, /\.pb-photos img\s*\{[^}]*max-width:\s*100%/);
  assert.match(builder, /\.pb-photos img\s*\{[^}]*height:\s*auto/);
});

test("encodePhotoForUpload downscales using EXIF-aware bitmap bounds", async () => {
  let width = 0;
  let height = 0;
  class FakeFileReader {
    readAsDataURL() {
      this.result = "data:image/jpeg;base64,YWJj";
      queueMicrotask(() => this.onload());
    }
  }
  const previous = globalThis.FileReader;
  globalThis.FileReader = FakeFileReader;
  try {
    const file = { type: "image/jpeg", name: "tall.jpg" };
    const encoded = await encodePhotoForUpload(file, {
      createImageBitmap: async () => ({ width: 4096, height: 8192, close() {} }),
      document: {
        createElement: () => ({
          width: 0,
          height: 0,
          getContext: () => ({ drawImage() {} }),
          toBlob(cb) {
            width = this.width;
            height = this.height;
            cb(new Blob(["jpeg"], { type: "image/jpeg" }));
          },
        }),
      },
    });
    assert.equal(width, 1024);
    assert.equal(height, 2048);
    assert.equal(encoded.photo_type, "image/jpeg");
    assert.ok(encoded.photo_base64);
  } finally {
    globalThis.FileReader = previous;
  }
});
