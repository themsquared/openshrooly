import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { writeStatusFile } from "../src/status-file.js";
import { defaultStatusBinds, startStatusServer } from "../src/status-http.js";

function lanIPv4() {
  for (const addrs of Object.values(networkInterfaces())) {
    for (const addr of addrs || []) {
      if (addr.family === "IPv4" && !addr.internal) {
        return addr.address;
      }
    }
  }
  return null;
}

describe("status HTTP bind", () => {
  it("defaults to loopback and never 0.0.0.0", () => {
    const binds = defaultStatusBinds({});
    assert.ok(binds.includes("127.0.0.1"));
    assert.ok(!binds.includes("0.0.0.0"));
  });

  it("refuses to listen on every interface", async () => {
    await assert.rejects(() => startStatusServer(0, () => ({}), ["0.0.0.0"]), /every interface/);
  });

  it("serves the hub on loopback and refuses LAN addresses", async () => {
    const started = await startStatusServer(0, () => ({ commissioned: false, qr: "MT:OK", chambers: 1 }), [
      "127.0.0.1",
    ]);
    try {
      const response = await fetch(`http://127.0.0.1:${started.port}/status`);
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.qr, "MT:OK");

      const lan = lanIPv4();
      if (lan) {
        await assert.rejects(fetch(`http://${lan}:${started.port}/status`));
      }
    } finally {
      await started.close();
    }
  });
});

describe("status file", () => {
  it("writes pairing JSON the hub compose mount can read", () => {
    const dir = mkdtempSync(join(tmpdir(), "sl-status-"));
    const path = join(dir, "status.json");
    writeStatusFile(path, { commissioned: false, qr: "MT:FILE", chambers: 3 });
    const saved = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(saved.reachable, true);
    assert.equal(saved.qr, "MT:FILE");
    assert.equal(saved.chambers, 3);
  });
});
