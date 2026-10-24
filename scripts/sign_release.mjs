#!/usr/bin/env node
// Signs an OpenShrooly release for https://shroomlabs.io/firmware/<channel>/.
//
//   node scripts/sign_release.mjs --key /path/outside/repo/key.pem --version 1.0.3-sl.1 \
//     --ota firmware.ota.bin --factory firmware.factory.bin --out community/web/public/firmware/stable
//
// The private key must live outside this repository (the release key is kept offline).
// The script refuses to sign if the key's public half differs from the one compiled
// into the device (esphome/components/updates.yaml), and checks its own signatures.
import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ORIGIN = "https://shroomlabs.io/firmware/";
const VERSION_RE = /^(0|[1-9]\d{0,6})\.(0|[1-9]\d{0,6})\.(0|[1-9]\d{0,6})(-sl\.(0|[1-9]\d{0,6}))?$/;

function args(argv) {
  const out = { channel: "stable" };
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i];
    if (!k.startsWith("--") || argv[i + 1] === undefined) throw new Error(`bad argument ${k}`);
    out[k.slice(2)] = argv[i + 1];
  }
  for (const need of ["key", "version", "ota", "factory", "out"]) {
    if (!out[need]) throw new Error(`missing --${need}`);
  }
  return out;
}

export function signedMessage({ product, channel, version, size, sha256, url }) {
  return (
    "openshrooly-release-v1\n" +
    `product=${product}\nchannel=${channel}\nversion=${version}\nsize=${size}\nsha256=${sha256}\nurl=${url}\n`
  );
}

export function devicePublicKeyHex(repo = REPO) {
  const yaml = readFileSync(join(repo, "esphome/components/updates.yaml"), "utf8");
  const m = yaml.match(/public_key:\s*"([0-9a-f]{64})"/);
  if (!m) throw new Error("public_key not found in esphome/components/updates.yaml");
  return m[1];
}

function rawPublicHex(publicKey) {
  return publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex");
}

function entry(privateKey, publicKey, fields) {
  const msg = Buffer.from(signedMessage(fields));
  const signature = sign(null, msg, privateKey).toString("base64");
  if (!verify(null, msg, publicKey, Buffer.from(signature, "base64"))) throw new Error("self-check failed");
  return { ...fields, signature };
}

export function signRelease(opts, repo = REPO) {
  if (!VERSION_RE.test(opts.version)) throw new Error("version must look like 1.0.3 or 1.0.3-sl.1");
  if (!/^[a-z]+$/.test(opts.channel)) throw new Error("channel must be lower-case letters");
  const keyPath = realpathSync(opts.key);
  if (!relative(realpathSync(repo), keyPath).startsWith("..")) {
    throw new Error("refusing to use a private key stored inside the repository");
  }
  const privateKey = createPrivateKey(readFileSync(keyPath));
  if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("key must be Ed25519");
  const publicKey = createPublicKey(privateKey);
  const expected = opts.expectPublic ?? devicePublicKeyHex(repo);
  if (rawPublicHex(publicKey) !== expected) {
    throw new Error("this key does not match the public key compiled into the device");
  }

  const base = `${ORIGIN}${opts.channel}/`;
  mkdirSync(opts.out, { recursive: true });
  const files = {};
  for (const [kind, src] of [["ota", opts.ota], ["factory", opts.factory]]) {
    const bytes = readFileSync(src);
    const name = `openshrooly-${opts.version}.${kind}.bin`;
    copyFileSync(src, join(opts.out, name));
    files[kind] = { name, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  }
  const ota = entry(privateKey, publicKey, {
    product: "openshrooly",
    channel: opts.channel,
    version: opts.version,
    size: files.ota.size,
    sha256: files.ota.sha256,
    url: base + files.ota.name,
  });
  // The USB image is signed under a different product name so its signature can
  // never be replayed as an over-the-air release.
  const usb = entry(privateKey, publicKey, {
    product: "openshrooly-usb",
    channel: opts.channel,
    version: opts.version,
    size: files.factory.size,
    sha256: files.factory.sha256,
    url: base + files.factory.name,
  });
  const manifest = { ...ota, usb, chip: "ESP32-S3", key: rawPublicHex(publicKey).slice(0, 16) };
  writeFileSync(join(opts.out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}

if (process.argv[1] && basename(process.argv[1]) === "sign_release.mjs") {
  try {
    const m = signRelease(args(process.argv.slice(2)));
    console.log(`signed ${m.version}: ota ${m.size} bytes ${m.sha256}, usb ${m.usb.size} bytes ${m.usb.sha256}`);
  } catch (e) {
    console.error(`sign_release: ${e.message}`);
    process.exit(1);
  }
}
