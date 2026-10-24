const FALLBACK_MANIFEST =
  "https://github.com/grahamsz/openshrooly/releases/latest/download/manifest.json";

function $(sel) {
  return document.querySelector(sel);
}

function params() {
  return new URLSearchParams(location.search);
}

function apiBase() {
  return String(window.SHROOM_LABS?.apiBase || "").replace(/\/$/, "");
}

async function latestFromApi() {
  const base = apiBase();
  if (!base) return null;
  const res = await fetch(`${base}/api/firmware/latest`);
  if (!res.ok) return null;
  return res.json();
}

async function verifyIfSigned(meta, filename) {
  const status = $("#status");
  if (!meta?.checksums_url || !meta?.signature_url) return;
  try {
    const [sumsRes, sigRes] = await Promise.all([fetch(meta.checksums_url), fetch(meta.signature_url)]);
    if (!sumsRes.ok) {
      status.textContent += " Checksums not published for this release.";
      return;
    }
    const checksums = await sumsRes.text();
    const signature = sigRes.ok ? await sigRes.text() : "";
    const base = apiBase();
    if (!base) return;
    const verified = await fetch(`${base}/api/firmware/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ checksums, signature: signature.trim(), filename }),
    });
    const data = await verified.json();
    if (data.ok) {
      status.textContent += " OTA checksum signature ok.";
      return;
    }
    status.textContent += meta.signature_required
      ? ` Unsigned OTA refused (${data.error}). USB factory flash still works.`
      : " Release is unsigned; USB factory flash still works.";
  } catch {
    status.textContent += " Could not verify the OTA signature from this browser.";
  }
}

async function loadManifest() {
  const status = $("#status");
  const error = $("#error");
  const button = $("#install-button");
  const override = params().get("manifest");
  let meta = null;
  try {
    meta = override ? { manifest_url: override } : await latestFromApi();
  } catch {
    meta = null;
  }
  const url = override || meta?.manifest_url || FALLBACK_MANIFEST;
  try {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) throw new Error(`manifest HTTP ${res.status}`);
    const manifest = await res.json();
    if (!manifest?.builds?.[0]?.parts?.length) throw new Error("manifest missing ESP32-S3 parts");
    button.manifest = url;
    button.classList.remove("hidden");
    status.textContent = `${manifest.name || "OpenShrooly"} ${manifest.version || ""} ready to install.`;
    const otaName = String(manifest.builds[0].ota?.path || "")
      .split("/")
      .pop();
    await verifyIfSigned(meta || { checksums_url: url.replace(/[^/]+$/, "SHA256SUMS"), signature_url: url.replace(/[^/]+$/, "SHA256SUMS.sig") }, otaName);
  } catch (err) {
    error.textContent = err.message || "Could not load the firmware manifest.";
    error.classList.remove("hidden");
    status.textContent = "Installer unavailable. Use openshrooly.com or a GitHub release.";
  }
}

loadManifest();
