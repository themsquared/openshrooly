/** Local hub on the LAN. Never send the community refresh token to the hub. */
export function createHubClient({ baseUrl = "http://127.0.0.1:8090" }) {
  return {
    devices: () => fetch(`${baseUrl}/`).then((r) => r.text()),
    applyProfile: (deviceId, profileId) =>
      fetch(`${baseUrl}/devices/${deviceId}/apply`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ profile_id: profileId, start_grow: "1" }),
      }),
  };
}
