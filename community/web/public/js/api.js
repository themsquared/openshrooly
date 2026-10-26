const cfg = window.SHROOM_LABS || window.OPENSHROOLY || { apiBase: "http://127.0.0.1:8787" };
const TOKEN_KEY = "openshrooly_token";

export function apiBase() {
  return String(cfg.apiBase || "").replace(/\/$/, "");
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || "";
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
  // Cached live device snapshots belong to the old sign-in.
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith("sl.live.")) localStorage.removeItem(k);
  } catch {
    // ignore
  }
}

export async function api(path, { method = "GET", body, jsonBody } = {}) {
  const headers = { accept: "application/json" };
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  const opts = { method, headers, credentials: "include" };
  if (jsonBody !== undefined) {
    headers["content-type"] = "application/json";
    opts.body = JSON.stringify(jsonBody);
  } else if (body !== undefined) {
    opts.body = body;
  }
  const res = await fetch(`${apiBase()}${path}`, opts);
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(data?.error || res.statusText);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export function isSignedIn() {
  return Boolean(getToken());
}

export function oidcStart(provider, next = "") {
  const qs = next ? `?next=${encodeURIComponent(next)}` : "";
  return `${apiBase()}/api/auth/oidc/${provider}/start${qs}`;
}

let capsCache = null;

export async function capabilities() {
  if (capsCache) return capsCache;
  try {
    capsCache = await api("/api/capabilities");
  } catch {
    capsCache = {
      email: false,
      google: false,
      apple: false,
      payments: false,
      photos: false,
      coach: false,
      push: false,
      show_psilocybin: window.SHROOM_LABS?.showPsilocybin !== false,
      stubs: false,
    };
  }
  return capsCache;
}
