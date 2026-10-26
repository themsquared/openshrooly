/** Cloudflare API client. Browser uses cookies; the app uses rotating token pairs. */
export function createCloudClient({ baseUrl, getTokens, setTokens }) {
  return {
    async request(path, { method = "GET", body } = {}) {
      const tokens = (await getTokens()) || {};
      const headers = { accept: "application/json", "content-type": "application/json" };
      if (tokens.access_token) headers.authorization = `Bearer ${tokens.access_token}`;
      const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.status === 401 && tokens.refresh_token) {
        const rotated = await fetch(`${baseUrl}/api/auth/refresh`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ refresh_token: tokens.refresh_token }),
        });
        if (rotated.ok) {
          const next = await rotated.json();
          await setTokens(next);
          return this.request(path, { method, body });
        }
      }
      return res.json();
    },
  };
}
