// The USB installer must only ever hand ESP Web Tools a Shroom Labs signed image.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { checkImage, installerManifest, loadVerifiedRelease, releaseUrlAllowed, signedMessage, verifyEntry, RELEASE_PUBLIC_KEY } from "../public/js/install.js";

const here = dirname(fileURLToPath(import.meta.url));
const pub = join(here, "..", "public");

function keypair() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return { privateKey, hex: publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex") };
}

function release(privateKey, bytes, over = {}) {
  const entry = {
    product: "openshrooly-usb",
    channel: "stable",
    version: "1.0.3-sl.1",
    size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    url: "https://shroomlabs.io/firmware/stable/openshrooly-1.0.3-sl.1.factory.bin",
    ...over,
  };
  entry.signature = sign(null, Buffer.from(signedMessage(entry)), privateKey).toString("base64");
  return entry;
}

const good = keypair();
const other = keypair();
const image = Buffer.from("pretend factory image");

test("a signed release passes and its exact bytes go to the installer", async () => {
  const usb = release(good.privateKey, image);
  const fetchFn = async (path) => {
    if (path === "/firmware/stable/manifest.json") return new Response(JSON.stringify({ usb }));
    assert.equal(path, "/firmware/stable/openshrooly-1.0.3-sl.1.factory.bin");
    return new Response(image);
  };
  const { entry, bytes } = await loadVerifiedRelease(fetchFn, { publicKeyHex: good.hex });
  assert.equal(entry.version, "1.0.3-sl.1");
  assert.deepEqual(Buffer.from(bytes), image);
  const m = installerManifest(entry, "blob:x");
  assert.deepEqual(m.builds[0].parts, [{ path: "blob:x", offset: 0 }]);
  assert.equal(m.builds[0].chipFamily, "ESP32-S3");
});

test("tampered fields, a wrong key, or an over-the-air entry are refused", async () => {
  const usb = release(good.privateKey, image);
  for (const [k, v] of [["version", "9.9.9"], ["size", usb.size + 1], ["sha256", "0".repeat(64)], ["url", usb.url.replace("factory", "other")], ["channel", "beta"]]) {
    await assert.rejects(verifyEntry({ ...usb, [k]: v }, { product: "openshrooly-usb", publicKeyHex: good.hex }), /invalid/, k);
  }
  await assert.rejects(verifyEntry(usb, { product: "openshrooly-usb", publicKeyHex: other.hex }), /invalid/);
  await assert.rejects(verifyEntry(release(other.privateKey, image), { product: "openshrooly-usb", publicKeyHex: good.hex }), /invalid/);
  const ota = release(good.privateKey, image, { product: "openshrooly" });
  await assert.rejects(verifyEntry(ota, { product: "openshrooly-usb", publicKeyHex: good.hex }), /invalid/);
  await assert.rejects(verifyEntry(null, { product: "openshrooly-usb", publicKeyHex: good.hex }), /invalid/);
});

test("a download that does not match the signed hash is refused", async () => {
  const usb = release(good.privateKey, image);
  await assert.rejects(checkImage(usb, Buffer.from("pretend factory imagE")), /invalid/);
  await assert.rejects(checkImage(usb, Buffer.concat([image, Buffer.from("x")])), /invalid/);
  const fetchFn = async (p) => (p.endsWith("manifest.json") ? new Response(JSON.stringify({ usb })) : new Response("evil"));
  await assert.rejects(loadVerifiedRelease(fetchFn, { publicKeyHex: good.hex }), /invalid/);
});

test("release links must stay on shroomlabs.io/firmware/stable", () => {
  assert.ok(releaseUrlAllowed("https://shroomlabs.io/firmware/stable/a.bin"));
  for (const bad of ["http://shroomlabs.io/firmware/stable/a.bin", "https://shroomlabs.io.evil.com/firmware/stable/a.bin", "https://shroomlabs.io/firmware/stable/../x.bin", "https://shroomlabs.io/firmware/stable/a.bin?x", "https://shroomlabs.io/firmware/stable/"]) {
    assert.equal(releaseUrlAllowed(bad), false, bad);
  }
});

test("installer key matches the key compiled into the device", () => {
  const yaml = readFileSync(join(here, "..", "..", "..", "esphome", "components", "updates.yaml"), "utf8");
  assert.equal(yaml.match(/public_key:\s*"([0-9a-f]{64})"/)[1], RELEASE_PUBLIC_KEY);
});

test("installer page loads nothing from other sites and has plain copy", () => {
  const html = readFileSync(join(pub, "install.html"), "utf8");
  for (const m of html.matchAll(/<script[^>]*src="([^"]+)"/g)) assert.ok(m[1].startsWith("/"), m[1]);
  assert.doesNotMatch(html, /unpkg|github|[\u2013\u2014]|firmware|\bOTA\b|manifest|Ed25519|ESP Web Tools/i);
  const toml = readFileSync(join(here, "..", "netlify.toml"), "utf8");
  const csp = toml.split('for = "/install"')[1].split("[[headers]]")[0];
  assert.doesNotMatch(csp, /unpkg|github/);
  assert.match(csp, /script-src 'self';/);
  const vendor = readdirSync(join(pub, "vendor", "esp-web-tools-10.4.0"));
  assert.ok(vendor.includes("install-button.js"));
});

test("published release, when present, is signed with the device key", async () => {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(pub, "firmware", "stable", "manifest.json"), "utf8"));
  } catch {
    return;
  }
  await verifyEntry(manifest, { product: "openshrooly" });
  await verifyEntry(manifest.usb, { product: "openshrooly-usb" });
  for (const e of [manifest, manifest.usb]) {
    await checkImage(e, readFileSync(join(pub, new URL(e.url).pathname)));
  }
});

test("no published release says coming soon, a real failure says network", async () => {
  const notFound = async () => ({ ok: false, status: 404, json: async () => ({}) });
  await assert.rejects(loadVerifiedRelease(notFound), (e) => e.message === "unreleased");
  const serverError = async () => ({ ok: false, status: 503, json: async () => ({}) });
  await assert.rejects(loadVerifiedRelease(serverError), (e) => e.message === "network");
  const offline = async () => { throw new TypeError("Failed to fetch"); };
  await assert.rejects(loadVerifiedRelease(offline), (e) => e.message === "network");
});
