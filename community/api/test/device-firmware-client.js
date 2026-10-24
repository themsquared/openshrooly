/**
 * Simulated chamber client. Request shapes match
 * esphome/external_components/shroom_labs_cloud/cloud_format.cpp
 * (Worker code wins if docs disagree: body SHA-256 is lowercase hex).
 */
import { buildCsr, generateP256, jwkOf, signDeviceProof } from "../src/devices.js";

export const PROOF_VERSION = "shroomlabs-device-pop-v1";

export function enrollBody({ hardware_id, public_jwk, name = "Chamber" }) {
  return { hardware_id, public_jwk, name };
}

export function csrBody({ csr, enroll_token }) {
  return { csr, enroll_token };
}

export function rotateBody({ csr }) {
  return { csr };
}

export function reclaimBody({ public_jwk }) {
  return public_jwk ? { public_jwk } : {};
}

export function claimUrl(code, site = "https://shroomlabs.io") {
  return `${String(site).replace(/\/$/, "")}/claim.html?code=${String(code || "").toUpperCase()}`;
}

export async function firmwareDevice() {
  const keys = await generateP256();
  return { keys, public_jwk: await jwkOf(keys.publicKey) };
}

export async function firmwareHeaders({ deviceId, key, method, path, body = "", nonce, serial }) {
  const proof = await signDeviceProof(key, { deviceId, nonce, method, path, body });
  const headers = {
    "content-type": "application/json",
    "x-device-nonce": nonce,
    "x-device-proof": proof,
    "user-agent": "ShroomLabs-chamber",
  };
  if (serial)
    headers["x-device-cert-serial"] = String(serial).toLowerCase();
  return headers;
}

export async function makeCsr(keys, deviceId) {
  return buildCsr(keys.privateKey, keys.publicKey, deviceId);
}
