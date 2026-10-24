// Claim URL and QR drawing for the local chamber page.
// The QR payload is only https://shroomlabs.io/claim.html?code=XXXXXX

function normalizeClaimCode(code) {
  return String(code || "")
    .toUpperCase()
    .replace(/[^A-Z2-9]/g, "")
    .slice(0, 6)
}

function claimUrl(code, site) {
  const base = String(site || "https://shroomlabs.io").replace(/\/$/, "")
  return `${base}/claim.html?code=${normalizeClaimCode(code)}`
}

function claimUrlOk(url, code) {
  const text = String(url || "")
  const want = `claim.html?code=${normalizeClaimCode(code)}`
  return text.startsWith("https://") && text.includes(want)
}

function drawQrModules(canvas, modules, size) {
  if (!canvas || !modules || !size)
    return false
  const ctx = canvas.getContext("2d")
  if (!ctx)
    return false
  const quiet = 3
  const n = Number(size)
  const px = Math.max(2, Math.floor(Math.min(canvas.width, canvas.height) / (n + quiet * 2)))
  const origin = Math.floor((Math.min(canvas.width, canvas.height) - px * n) / 2)
  ctx.fillStyle = "#f4fff6"
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = "#0b1a12"
  const bits = String(modules)
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (bits[y * n + x] === "1")
        ctx.fillRect(origin + x * px, origin + y * px, px, px)
    }
  }
  return true
}

module.exports = { normalizeClaimCode, claimUrl, claimUrlOk, drawQrModules }
