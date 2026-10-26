import { test } from "node:test";
import assert from "node:assert/strict";
import { clientIp, rateLimit, rateLimitClient, rateLimitIp } from "../src/security.js";
import { call, testEnv } from "./helpers.js";

test("rateLimitIp keys IPv6 on /64 and IPv4 on the full address", () => {
  assert.equal(rateLimitIp("2001:db8:1:2:aaaa::1"), "2001:db8:1:2::/64");
  assert.equal(rateLimitIp("2001:0db8:0001:0002:bbbb:0:0:2"), "2001:db8:1:2::/64");
  assert.equal(rateLimitIp("[2001:db8:1:2::3]"), "2001:db8:1:2::/64");
  assert.equal(rateLimitIp("2001:db8:1:2::1, 10.0.0.1"), "2001:db8:1:2::/64");
  assert.equal(rateLimitIp("::ffff:192.0.2.10"), "192.0.2.10");
  assert.equal(rateLimitIp("192.0.2.10"), "192.0.2.10");
  assert.equal(rateLimitIp("192.0.2.11"), "192.0.2.11");
});

test("spoofed X-Forwarded-For without CF-Connecting-IP does not become the rate-limit key", () => {
  const spoofed = new Request("https://api.shroomlabs.io/api/auth/webauthn/login/begin", {
    headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" },
  });
  assert.equal(clientIp(spoofed), "");
  assert.equal(rateLimitClient(spoofed), "");
  assert.notEqual(rateLimitIp("203.0.113.9"), "");

  const trusted = new Request("https://api.shroomlabs.io/api/auth/webauthn/login/begin", {
    headers: { "cf-connecting-ip": "198.51.100.20", "x-forwarded-for": "203.0.113.9" },
  });
  assert.equal(clientIp(trusted), "198.51.100.20");
  assert.equal(rateLimitClient(trusted), "198.51.100.20");
});

test("rotating IPv6 addresses inside one /64 trip the rate limit", async () => {
  const ctx = testEnv();
  let last;
  for (let i = 0; i < 11; i += 1) {
    last = await call(ctx, "POST", "/api/auth/webauthn/login/begin", {
      headers: { "cf-connecting-ip": `2001:db8:aaaa:bbbb:${i.toString(16)}::${i + 1}` },
      body: {},
    });
  }
  assert.equal(last.status, 429);

  const otherPrefix = await call(ctx, "POST", "/api/auth/webauthn/login/begin", {
    headers: { "cf-connecting-ip": "2001:db8:aaaa:cccc::1" },
    body: {},
  });
  assert.equal(otherPrefix.status, 200);

  const v4a = await call(ctx, "POST", "/api/auth/webauthn/login/begin", {
    headers: { "cf-connecting-ip": "192.0.2.10" },
    body: {},
  });
  const v4b = await call(ctx, "POST", "/api/auth/webauthn/login/begin", {
    headers: { "cf-connecting-ip": "192.0.2.11" },
    body: {},
  });
  assert.equal(v4a.status, 200);
  assert.equal(v4b.status, 200);
});

test("rate limit increment is atomic under concurrency", async () => {
  const ctx = testEnv();
  const results = await Promise.all(Array.from({ length: 20 }, () => rateLimit(ctx.db, "burst", 5, 900)));
  assert.equal(results.filter((row) => row.ok).length, 5);
  const stored = await ctx.db.one("SELECT * FROM rate_limits WHERE key=?", ["burst"]);
  assert.equal(Number(stored.count), 5);
});
