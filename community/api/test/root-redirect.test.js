import { test } from "node:test";
import assert from "node:assert/strict";
import { call, testEnv } from "./helpers.js";

test("the bare API host redirects to the site instead of a JSON 404", async () => {
  const ctx = testEnv({ SITE_ORIGIN: "https://shroomlabs.io" });
  const res = await call(ctx, "GET", "/");
  assert.equal(res.status, 301);
  assert.equal(res.headers.get("location"), "https://shroomlabs.io/");
});

test("other unknown paths still return 404", async () => {
  const ctx = testEnv();
  const res = await call(ctx, "GET", "/no-such-route");
  assert.equal(res.status, 404);
});
