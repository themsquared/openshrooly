import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("write-config emits apiBase and turnstileSiteKey from env", () => {
  const script = fileURLToPath(new URL("./write-config.js", import.meta.url));
  const configPath = fileURLToPath(new URL("../public/js/config.js", import.meta.url));
  const registerPath = fileURLToPath(new URL("../public/register.html", import.meta.url));
  const before = readFileSync(configPath, "utf8");
  try {
    const result = spawnSync(process.execPath, [script], {
      encoding: "utf8",
      env: {
        ...process.env,
        API_BASE_URL: "https://api.shroomlabs.io",
        TURNSTILE_SITE_KEY: "0x4AAAAAAFjd0Rzec6mAd5y6",
      },
    });
    assert.equal(result.status, 0, result.stderr);
    const written = readFileSync(configPath, "utf8");
    assert.match(written, /apiBase: "https:\/\/api.shroomlabs.io"/);
    assert.match(written, /turnstileSiteKey: "0x4AAAAAAFjd0Rzec6mAd5y6"/);
  } finally {
    writeFileSync(configPath, before);
  }
  assert.doesNotMatch(readFileSync(registerPath, "utf8"), /Turnstile and OIDC keys are documented/);
});
