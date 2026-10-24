/** Thin re-exports. Photo sanitizing lives in photos.js (strict JPEG allowlist). */

export {
  PHOTO_MAX_BYTES as MAX_PHOTO_BYTES,
  PHOTO_MAX_EDGE as MAX_PHOTO_EDGE,
  MAX_PHOTO_BASE64_CHARS,
  bytesToBase64,
  decodePhotoBase64,
  sanitizeGrowPhoto,
  sniffImage,
} from "./photos.js";
