// USB installer. Offers only Shroom Labs signed releases.
//
// 1. Loads /firmware/stable/manifest.json from this site.
// 2. Checks the USB entry's Ed25519 signature against the public key below
//    (the same key compiled into the device for Wi-Fi updates).
// 3. Downloads the image, checks its size and SHA-256 against the signed values.
// 4. Hands ESP Web Tools the bytes that passed, so nothing else can be flashed.
// Any failure leaves the Install button hidden.

export const RELEASE_PUBLIC_KEY = "d060c2d2edb7871bcd6e211e23df8378e470cecf4ffb8575490fbbabab4afcdb";
export const MANIFEST_PATH = "/firmware/stable/manifest.json";
export const RELEASE_PREFIX = "https://shroomlabs.io/firmware/stable/";
const VERSION_RE = /^(0|[1-9]\d{0,6})\.(0|[1-9]\d{0,6})\.(0|[1-9]\d{0,6})(-sl\.(0|[1-9]\d{0,6}))?$/;
const MAX_IMAGE = 16 * 1024 * 1024;

export class ReleaseError extends Error {}

const PLAIN = {
  network: "Could not load the latest release from shroomlabs.io. Check your connection and reload this page.",
  invalid: "The latest release did not pass the Shroom Labs signature check, so the installer is turned off. Try again later.",
  browser: "Your browser cannot check release signatures. Update Chrome or Edge and reload this page.",
};

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function base64ToBytes(b64) {
  if (!/^[A-Za-z0-9+/]{86}==$/.test(b64)) throw new ReleaseError("invalid");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export function releaseUrlAllowed(url) {
  if (typeof url !== "string" || url.length > 200 || !url.startsWith(RELEASE_PREFIX)) return false;
  const rest = url.slice(RELEASE_PREFIX.length);
  return rest.length > 0 && /^[A-Za-z0-9._/-]+$/.test(rest) && !rest.includes("..") && !rest.includes("//");
}

export function signedMessage(e) {
  return (
    "openshrooly-release-v1\n" +
    `product=${e.product}\nchannel=${e.channel}\nversion=${e.version}\nsize=${e.size}\nsha256=${e.sha256}\nurl=${e.url}\n`
  );
}

export async function verifyEntry(entry, { product, publicKeyHex = RELEASE_PUBLIC_KEY, subtle = globalThis.crypto?.subtle } = {}) {
  if (!entry || typeof entry !== "object") throw new ReleaseError("invalid");
  const ok =
    entry.product === product &&
    entry.channel === "stable" &&
    typeof entry.version === "string" &&
    VERSION_RE.test(entry.version) &&
    Number.isSafeInteger(entry.size) &&
    entry.size > 0 &&
    entry.size <= MAX_IMAGE &&
    typeof entry.sha256 === "string" &&
    /^[0-9a-f]{64}$/.test(entry.sha256) &&
    releaseUrlAllowed(entry.url) &&
    typeof entry.signature === "string";
  if (!ok) throw new ReleaseError("invalid");
  let key;
  try {
    key = await subtle.importKey("raw", hexToBytes(publicKeyHex), { name: "Ed25519" }, false, ["verify"]);
  } catch {
    throw new ReleaseError("browser");
  }
  const valid = await subtle.verify({ name: "Ed25519" }, key, base64ToBytes(entry.signature), new TextEncoder().encode(signedMessage(entry)));
  if (!valid) throw new ReleaseError("invalid");
  return entry;
}

export async function checkImage(entry, bytes, subtle = globalThis.crypto?.subtle) {
  if (bytes.byteLength !== entry.size) throw new ReleaseError("invalid");
  const digest = new Uint8Array(await subtle.digest("SHA-256", bytes));
  const hex = Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
  if (hex !== entry.sha256) throw new ReleaseError("invalid");
}

// Loads and verifies the USB release. fetchFn reads paths on this site only.
export async function loadVerifiedRelease(fetchFn = (p) => fetch(p, { cache: "no-store", credentials: "omit" }), opts = {}) {
  let manifest;
  try {
    const res = await fetchFn(MANIFEST_PATH);
    if (!res.ok) throw new Error();
    manifest = await res.json();
  } catch {
    throw new ReleaseError("network");
  }
  const usb = await verifyEntry(manifest?.usb, { ...opts, product: "openshrooly-usb" });
  let bytes;
  try {
    const res = await fetchFn(new URL(usb.url).pathname);
    if (!res.ok) throw new Error();
    bytes = await res.arrayBuffer();
  } catch {
    throw new ReleaseError("network");
  }
  await checkImage(usb, bytes, opts.subtle);
  return { entry: usb, bytes };
}

export function installerManifest(entry, imageUrl) {
  return {
    name: "OpenShrooly",
    version: entry.version,
    new_install_prompt_erase: true,
    builds: [{ chipFamily: "ESP32-S3", improv: true, parts: [{ path: imageUrl, offset: 0 }] }],
  };
}

async function main() {
  const status = document.querySelector("#status");
  const error = document.querySelector("#error");
  const button = document.querySelector("#install-button");
  try {
    const { entry, bytes } = await loadVerifiedRelease();
    const imageUrl = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
    const manifest = installerManifest(entry, imageUrl);
    button.manifest = URL.createObjectURL(new Blob([JSON.stringify(manifest)], { type: "application/json" }));
    button.classList.remove("hidden");
    status.textContent = `Version ${entry.version} is ready. It passed the Shroom Labs signature check.`;
  } catch (err) {
    const kind = err instanceof ReleaseError ? err.message : "network";
    error.textContent = PLAIN[kind] || PLAIN.network;
    error.classList.remove("hidden");
    status.textContent = "The installer is not available right now.";
  }
}

if (typeof document !== "undefined") main();
