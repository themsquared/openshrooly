import { test } from "node:test";
import { X509Certificate } from "node:crypto";
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

test("CA and device certs are valid X.509 to standard verifiers (KeyUsage encoding)", async () => {
  const ca = await createWorkerCa();
  const device = await generateP256();
  const csr = await buildCsr(device.privateKey, device.publicKey, "sldev_ku");
  const leaf = new X509Certificate((await issueDeviceCertificate(ca, csr, { cn: "sldev_ku", days: 7 })).pem);
  const root = new X509Certificate(ca.certPem);
  assert.equal(root.ca, true);
  assert.equal(root.checkIssued(root), true);
  assert.equal(leaf.checkIssued(root), true);
  assert.equal(leaf.verify(root.publicKey), true);
  assert.deepEqual(leaf.keyUsage, ["1.3.6.1.5.5.7.3.2"]);
  assert.equal("keyPem" in ca, false);
});
