const test = require("node:test")
const assert = require("node:assert/strict")
const { normalizeClaimCode, claimUrl, claimUrlOk } = require("./cloud-claim.js")

test("claim URL is the public claim page plus the 6-character code", () => {
  assert.equal(normalizeClaimCode("ab 2c3d"), "AB2C3D")
  assert.equal(claimUrl("ab2c3d"), "https://shroomlabs.io/claim.html?code=AB2C3D")
  assert.equal(claimUrlOk("https://shroomlabs.io/claim.html?code=AB2C3D", "AB2C3D"), true)
  assert.equal(claimUrlOk("http://evil.example/claim.html?code=AB2C3D", "AB2C3D"), false)
  assert.equal(claimUrlOk("https://shroomlabs.io/claim.html?code=XXXXXX", "AB2C3D"), false)
})
