import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { loadOrCreateIdentity } from "../src/identity.js";

describe("identity file", () => {
  it("persists passcode and discriminator", () => {
    const dir = mkdtempSync(join(tmpdir(), "sl-id-"));
    const first = loadOrCreateIdentity(dir, { passcode: 38472651, discriminator: 99, uniqueId: "abc" });
    const second = loadOrCreateIdentity(dir);
    assert.deepEqual(second, first);
  });

  it("refuses the well-known test passcode", () => {
    const dir = mkdtempSync(join(tmpdir(), "sl-id-"));
    assert.throws(() => loadOrCreateIdentity(dir, { passcode: 20202021 }), /well-known/);
  });
});
