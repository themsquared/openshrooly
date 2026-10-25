import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BRIDGE_LOOP_BACKOFF_MS, runBridgeLoop } from "../scripts/coach-local-bridge.js";

test("bridge --loop catches per-cycle errors, backs off 60s, and retries", async () => {
  assert.equal(BRIDGE_LOOP_BACKOFF_MS, 60_000);
  const sleeps = [];
  const logs = [];
  let n = 0;
  await runBridgeLoop({
    looping: true,
    intervalMs: 5_000,
    errorBackoffMs: BRIDGE_LOOP_BACKOFF_MS,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    log: (line) => logs.push(String(line)),
    stop: () => n >= 3,
    runOnce: async () => {
      n += 1;
      if (n === 1) throw new Error("SQLITE_BUSY: database is locked");
    },
  });
  assert.ok(n >= 2);
  assert.ok(sleeps.includes(60_000));
  assert.ok(logs.some((line) => /bridge error/i.test(line) && /60s/.test(line)));
});

test("bridge without --loop still throws so a one-shot can exit", async () => {
  await assert.rejects(
    () =>
      runBridgeLoop({
        looping: false,
        runOnce: async () => {
          throw new Error("mark failed");
        },
        sleep: async () => {},
        log() {},
      }),
    /mark failed/
  );
});

test("command-marking D1 writes throw instead of process.exit", () => {
  const d1 = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../scripts/coach-local-d1.js"), "utf8");
  const bridge = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../scripts/coach-local-bridge.js"), "utf8");
  assert.match(d1, /function wranglerLocalD1Command[\s\S]*throwOnError = true/);
  assert.match(bridge, /runBridgeLoop/);
  assert.match(bridge, /wranglerLocalD1Command\(/);
  assert.doesNotMatch(bridge, /wranglerLocalD1Command\([\s\S]*throwOnError:\s*false/);
});
