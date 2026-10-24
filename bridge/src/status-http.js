import { createServer } from "node:http";
import { networkInterfaces } from "node:os";

const DOCKER_IFACE = /^(docker\d*|br-[0-9a-f]+|cni\d*|podman\d*|lima0)$/i;

export function defaultStatusBinds(env = process.env) {
  if (env.BRIDGE_STATUS_BIND) {
    return env.BRIDGE_STATUS_BIND.split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  const binds = new Set(["127.0.0.1"]);
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    if (!DOCKER_IFACE.test(name)) {
      continue;
    }
    for (const addr of addrs || []) {
      if (addr.family === "IPv4" && !addr.internal) {
        binds.add(addr.address);
      }
    }
  }
  return [...binds];
}

function handler(getStatus) {
  return (request, response) => {
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
  };
}

function listen(port, host, requestHandler) {
  const server = createServer(requestHandler);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      const address = server.address();
      resolve({ server, host, port: typeof address === "object" && address ? address.port : port });
    });
  });
}

export async function startStatusServer(port, getStatus, binds = defaultStatusBinds()) {
  if (!binds.length) {
    throw new Error("status server needs at least one bind address");
  }
  if (binds.includes("0.0.0.0") || binds.includes("::")) {
    throw new Error("status server must not listen on every interface");
  }
  const requestHandler = handler(getStatus);
  const started = [];
  try {
    for (const host of binds) {
      started.push(await listen(port, host, requestHandler));
      if (port === 0) {
        port = started[0].port;
      }
    }
  } catch (error) {
    await Promise.all(started.map((item) => new Promise((resolve) => item.server.close(resolve))));
    throw error;
  }
  return {
    port: started[0].port,
    addresses: started.map((item) => `${item.host}:${item.port}`),
    close() {
      return Promise.all(started.map((item) => new Promise((resolve) => item.server.close(resolve))));
    },
  };
}
