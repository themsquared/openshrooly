import { createServer } from "node:http";

export function startStatusServer(port, getStatus) {
  const server = createServer((request, response) => {
    const path = request.url?.split("?")[0];
    if (request.method === "GET" && (path === "/status" || path === "/health")) {
      let body;
      try {
        body = getStatus();
      } catch {
        response.writeHead(500, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: false }));
        return;
      }
      if (path === "/health") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: true, commissioned: Boolean(body.commissioned) }));
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, ...body }));
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: false }));
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}
