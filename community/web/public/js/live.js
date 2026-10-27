/**
 * Live device data for the Devices, Device and Fleet pages.
 *
 * - paint at once from the last snapshot this browser saw (localStorage),
 * - fetch the current one in a single request,
 * - then stay current over a WebSocket, falling back to a 30 second poll
 *   whenever the socket is down (and on tab focus).
 */
import { api, apiBase, getToken } from "./api.js";

export const LIVE_PROTOCOL = "shroomlabs-live.v1";
const CACHE_PREFIX = "sl.live.v1.";
const POLL_MS = 30 * 1000;
const PING_MS = 25 * 1000;
const BACKOFF_MS = [1000, 2000, 5000, 10000, 30000];

/** Cached snapshots belong to one sign-in; a different token never sees them. */
function owner() {
  return getToken().slice(-12);
}

export const liveCache = {
  get(key) {
    try {
      const raw = localStorage.getItem(CACHE_PREFIX + key);
      if (!raw) return null;
      const entry = JSON.parse(raw);
      return entry?.who === owner() && entry.who ? entry : null;
    } catch {
      return null;
    }
  },
  set(key, data) {
    try {
      localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ who: owner(), at: Date.now(), data }));
    } catch {
      // storage full or blocked: live data still works
    }
  },
  clear() {
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith(CACHE_PREFIX)) localStorage.removeItem(k);
    } catch {
      // ignore
    }
  },
};

export function liveSocketUrl(path, base = apiBase()) {
  const root = base || location.origin;
  return root.replace(/^http(s?):/, "ws$1:") + path;
}

/**
 * Keep one resource current. `load()` fetches it over HTTP; `socketPath` streams
 * changes; `onData(data, { source })` repaints; `onMessage` handles socket messages
 * (defaults to treating a {type:"snapshot"} as data). `onState("live"|"polling"|"gone")`.
 */
export function keepLive({ load, socketPath, onData, onMessage, onState = () => {}, onError = () => {} }) {
  let ws = null;
  let stopped = false;
  let attempt = 0;
  let pollTimer = null;
  let pingTimer = null;
  let retryTimer = null;
  let socketUp = false;

  async function refresh() {
    try {
      const data = await load();
      if (!stopped && data) onData(data, { source: "http" });
    } catch (err) {
      if (!stopped) onError(err);
    }
  }

  function schedulePoll() {
    clearTimeout(pollTimer);
    if (stopped || socketUp) return;
    pollTimer = setTimeout(async () => {
      if (document.visibilityState !== "hidden") await refresh();
      schedulePoll();
    }, POLL_MS);
  }

  function connect() {
    if (stopped || !socketPath || typeof WebSocket !== "function") return schedulePoll();
    const token = getToken();
    const protocols = [LIVE_PROTOCOL, ...(token ? [`bearer.${token}`] : [])];
    try {
      ws = new WebSocket(liveSocketUrl(socketPath), protocols);
    } catch {
      return schedulePoll();
    }
    ws.addEventListener("open", () => {
      socketUp = true;
      attempt = 0;
      clearTimeout(pollTimer);
      onState("live");
      clearInterval(pingTimer);
      pingTimer = setInterval(() => {
        try {
          ws.send("ping");
        } catch {
          // close handler reconnects
        }
      }, PING_MS);
    });
    ws.addEventListener("message", (ev) => {
      if (ev.data === "pong") return;
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (onMessage) onMessage(msg);
      else if (msg.type === "snapshot" && msg.snapshot) onData(msg.snapshot, { source: "socket" });
    });
    ws.addEventListener("close", (ev) => {
      const wasUp = socketUp;
      socketUp = false;
      clearInterval(pingTimer);
      ws = null;
      if (stopped) return;
      if (ev.code === 4003) {
        onState("gone");
        return;
      }
      onState("polling");
      schedulePoll();
      // 4001: the server wants a fresh sign-in check; reconnect right away.
      const wait = ev.code === 4001 ? 0 : BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
      attempt += 1;
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => {
        // Catch up on anything missed while the socket was down.
        if (wasUp || attempt > 1) refresh();
        connect();
      }, wait);
    });
  }

  const onVisible = () => {
    if (document.visibilityState === "visible" && !socketUp) refresh();
  };
  document.addEventListener("visibilitychange", onVisible);

  connect();
  schedulePoll();

  return {
    refresh,
    /** Hand over data the caller loaded itself (the first page load). */
    push(data) {
      if (!stopped && data) onData(data, { source: "http" });
    },
    stop() {
      stopped = true;
      clearTimeout(pollTimer);
      clearTimeout(retryTimer);
      clearInterval(pingTimer);
      document.removeEventListener("visibilitychange", onVisible);
      try {
        ws?.close(1000);
      } catch {
        // ignore
      }
    },
    get live() {
      return socketUp;
    },
  };
}

/** One device's page snapshot. Falls back to the older endpoints if the live API is not there yet. */
export async function loadDeviceSnapshot(id) {
  const enc = encodeURIComponent(id);
  try {
    return await api(`/api/live/devices/${enc}`);
  } catch (err) {
    if (err.status !== 404 || err.data?.error === "not your device") throw err;
    const [detail, alerts] = await Promise.all([
      api(`/api/fleet/devices/${enc}`),
      api(`/api/devices/${enc}/alerts`).catch(() => null),
    ]);
    return { device: detail.device, history: detail.history, events: detail.events || [], range: detail.range || null, alerts, coach_available: null, source: "legacy" };
  }
}

export async function loadDeviceList() {
  try {
    return await api("/api/live/devices");
  } catch (err) {
    if (err.status !== 404) throw err;
    return api("/api/fleet/devices");
  }
}

/** "updated 2 min ago" style age for the live badge. */
export function ageText(iso, now = Date.now()) {
  const t = Date.parse(iso || "");
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}
