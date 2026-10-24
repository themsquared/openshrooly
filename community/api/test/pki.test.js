import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCsr, createWorkerCa, generateP256, issueDeviceCertificate, verifyCsr } from "../src/pki.js";

test("Worker CA issues and verifies an ECDSA P-256 device CSR", async () => {
  const ca = await createWorkerCa();
  const device = await generateP256();
  const csr = await buildCsr(device.privateKey, device.publicKey, "sldev_test");
  const verified = await verifyCsr(csr);
  assert.equal(verified.jwk.crv, "P-256");
  const cert = await issueDeviceCertificate(ca, csr, { cn: "sldev_test", days: 7 });
  assert.match(cert.pem, /BEGIN CERTIFICATE/);
  assert.equal(cert.serial.length, 32);
  assert.equal(cert.fingerprint.length, 64);
});

test("tampered CSR is rejected", async () => {
  const device = await generateP256();
  const csr = await buildCsr(device.privateKey, device.publicKey, "sldev_bad");
  const lines = csr.split("\n");
  const body = lines.find((line) => line && !line.startsWith("-----"));
  const mangled = csr.replace(body, "A".repeat(body.length));
  await assert.rejects(() => verifyCsr(mangled));
});
