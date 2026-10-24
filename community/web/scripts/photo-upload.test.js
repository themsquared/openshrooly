import { test } from "node:test";
import assert from "node:assert/strict";
import { encodePhotoForUpload, resolveMediaUrl } from "../public/js/photo-upload.js";

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
