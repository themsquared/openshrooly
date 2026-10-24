import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checksumLines,
  latestFirmwareMeta,
  refuseUnsignedOta,
  signChecksums,
  validateManifest,
  verifyChecksums,
} from "../src/firmware-sign.js";

async function ed25519PemPair() {
  const pair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
  const toPem = (type, bytes) =>
    `-----BEGIN ${type}-----\n${btoa(String.fromCharCode(...bytes))}\n-----END ${type}-----\n`;
  return {
    privatePem: toPem("PRIVATE KEY", pkcs8),
    publicPem: toPem("PUBLIC KEY", spki),
  };
}

test("signed checksums verify and unsigned OTA is refused", async () => {
  const { privatePem, publicPem } = await ed25519PemPair();
  const files = [
    { name: "openshrooly-esp32s3.factory.bin", bytes: Buffer.from("factory") },
    { name: "openshrooly-esp32s3.ota.bin", bytes: Buffer.from("ota") },
  ];
  const sums = await checksumLines(files);
  const sig = await signChecksums(sums, privatePem);
  assert.equal(await verifyChecksums(sums, sig, publicPem), true);
  assert.equal(await verifyChecksums(sums + "\n", sig, publicPem), false);
  assert.deepEqual(
    await refuseUnsignedOta({ checksums: "", signature: "", publicPem, filename: files[1].name }),
    { ok: false, error: "unsigned firmware rejected" }
  );
  const ok = await refuseUnsignedOta({
    checksums: sums,
    signature: sig,
    publicPem,
    filename: "openshrooly-esp32s3.ota.bin",
  });
  assert.equal(ok.ok, true);
  assert.match(ok.sha256, /^[0-9a-f]{64}$/);
});

test("ESP Web Tools manifest requires an ESP32-S3 factory part and OTA path", () => {
  const bad = validateManifest({ name: "OpenShrooly", version: "1.0.2", builds: [] });
  assert.equal(bad.ok, false);
  const good = validateManifest({
    name: "OpenShrooly",
    version: "1.0.2",
    builds: [
      {
        chipFamily: "ESP32-S3",
        ota: { path: "https://example.com/openshrooly-esp32s3.ota.bin", md5: "0".repeat(32) },
        parts: [{ path: "https://example.com/openshrooly-esp32s3.factory.bin", offset: 0 }],
      },
    ],
  });
  assert.equal(good.ok, true);
});

test("latest firmware meta points at grahamsz until a signing key is set", () => {
  const unsigned = latestFirmwareMeta({});
  assert.match(unsigned.manifest_url, /grahamsz\/openshrooly/);
  assert.equal(unsigned.signature_required, false);
  const signed = latestFirmwareMeta({ FIRMWARE_SIGNING_PUB: "-----BEGIN PUBLIC KEY-----" });
  assert.equal(signed.signature_required, true);
});
