import { randomBytes, randomInt } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const INVALID_PASSCODES = new Set([
  0, 11111111, 22222222, 33333333, 44444444, 55555555, 66666666, 77777777, 88888888, 99999999,
  12345678, 87654321,
]);

const WELL_KNOWN_TEST_PASSCODE = 20202021;

export function isValidPasscode(passcode) {
  return Number.isInteger(passcode) && passcode >= 1 && passcode <= 99999998 && !INVALID_PASSCODES.has(passcode);
}

export function randomPasscode() {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const passcode = randomInt(1, 99999999);
    if (isValidPasscode(passcode) && passcode !== WELL_KNOWN_TEST_PASSCODE) {
      return passcode;
    }
  }
  throw new Error("could not generate a Matter passcode");
}

export function randomDiscriminator() {
  return randomInt(1, 4096);
}

export function randomUniqueId() {
  return randomBytes(8).toString("hex");
}

export function identityPath(storageDir) {
  return join(storageDir, "identity.json");
}

export function loadOrCreateIdentity(storageDir, overrides = {}) {
  mkdirSync(storageDir, { recursive: true });
  const path = identityPath(storageDir);
  let stored = {};
  try {
    stored = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    stored = {};
  }

  const identity = {
    uniqueId: String(overrides.uniqueId || stored.uniqueId || randomUniqueId()),
    passcode: Number(overrides.passcode || stored.passcode || randomPasscode()),
    discriminator: Number(overrides.discriminator || stored.discriminator || randomDiscriminator()),
  };

  if (!isValidPasscode(identity.passcode)) {
    throw new Error("stored Matter passcode is not valid");
  }
  if (identity.passcode === WELL_KNOWN_TEST_PASSCODE && !overrides.allowWellKnownPasscode) {
    throw new Error("refusing the well-known test passcode");
  }
  if (!Number.isInteger(identity.discriminator) || identity.discriminator < 0 || identity.discriminator > 4095) {
    throw new Error("stored Matter discriminator is not valid");
  }

  writeFileSync(path, `${JSON.stringify(identity, null, 2)}\n`, { mode: 0o600 });
  void dirname;
  return identity;
}
