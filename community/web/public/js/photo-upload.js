/** Client photo helpers: resolve /api/media URLs and re-encode before upload. */

export function resolveMediaUrl(href, apiBase) {
  const value = String(href || "");
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("/")) return `${String(apiBase || "").replace(/\/$/, "")}${value}`;
  return value;
}

export async function encodePhotoForUpload(file, { createImageBitmap: bitmapFn, document: doc } = {}) {
  const makeBitmap = bitmapFn || globalThis.createImageBitmap;
  const documentRef = doc || globalThis.document;
  if (typeof makeBitmap === "function" && documentRef?.createElement) {
    try {
      const bitmap = await makeBitmap(file, { imageOrientation: "from-image" });
      const maxEdge = 2048;
      const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = documentRef.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(bitmap, 0, 0, width, height);
      if (typeof bitmap.close === "function") bitmap.close();
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob((next) => (next ? resolve(next) : reject(new Error("encode failed"))), "image/jpeg", 0.92);
      });
      return {
        photo_base64: await blobToBase64(blob),
        photo_type: "image/jpeg",
        photo_ext: "jpg",
      };
    } catch {
      /* fall through to the raw file */
    }
  }
  return {
    photo_base64: await blobToBase64(file),
    photo_type: file.type || "image/jpeg",
    photo_ext: String(file.name || "jpg").split(".").pop()?.toLowerCase() || "jpg",
  };
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      resolve(result.split(",")[1] || "");
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
