const cfg = window.OPENSHROOLY || { apiBase: "http://127.0.0.1:8787" };
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
}

export async function api(path, { method = "GET", body, jsonBody } = {}) {
  const headers = { accept: "application/json" };
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  const opts = { method, headers };
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
