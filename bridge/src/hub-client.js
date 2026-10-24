export async function fetchHubState(hubUrl, fetchImpl = fetch) {
  const url = `${String(hubUrl).replace(/\/$/, "")}/api/smart-home/state`;
  const response = await fetchImpl(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`hub state HTTP ${response.status}`);
  }
  const body = await response.json();
  if (!body || !Array.isArray(body.chambers)) {
    throw new Error("hub state is missing chambers");
  }
  return body;
}
