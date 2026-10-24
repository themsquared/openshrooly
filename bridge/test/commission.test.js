import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { Seconds, ServerNode } from "@matter/main";

import { loadOrCreateIdentity } from "../src/identity.js";
import {
  createBridgeEnvironment,
  createMatterBridge,
  pairingStatus,
  pollHub,
} from "../src/matter-bridge.js";

const CHAMBER = {
  id: 4,
  name: "Test chamber",
  mac: null,
  online: true,
  temperature_c: 22.5,
  humidity_pct: 90,
  water_pct: 8,
  needs_water: true,
  light_on: false,
};

function collectReadings(node) {
  const readings = [];
  for (const endpoint of node.endpoints) {
    const state = endpoint.state || {};
    readings.push({
      id: String(endpoint.id),
      number: endpoint.number,
      temperature: state.temperatureMeasurement?.measuredValue,
      humidity: state.relativeHumidityMeasurement?.measuredValue,
      contact: state.booleanState?.stateValue,
      reachable: state.bridgedDeviceBasicInformation?.reachable,
      label: state.bridgedDeviceBasicInformation?.nodeLabel,
    });
  }
  return readings;
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server.address().port);
    });
  });
}

describe("matter.js controller commissions the bridge", () => {
  let hub;
  let bridge;
  let controller;
  let identity;

  before(async () => {
    hub = createServer((request, response) => {
      if (request.url?.startsWith("/api/smart-home/state")) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ chambers: [CHAMBER], needs_water_threshold_pct: 15 }));
        return;
      }
      response.writeHead(404);
      response.end();
    });
    const hubPort = await listen(hub);
    const root = mkdtempSync(join(tmpdir(), "sl-matter-"));
    identity = loadOrCreateIdentity(join(root, "bridge-id"), {
      passcode: 38472651,
      discriminator: 2910,
      uniqueId: "sh1test",
    });

    const bridgeEnv = createBridgeEnvironment("sh1-bridge", join(root, "bridge"), "error");
    bridge = await createMatterBridge({
      identity,
      storagePath: join(root, "bridge"),
      port: 0,
      environment: bridgeEnv,
      logLevel: "error",
    });
    await bridge.server.start();
    await pollHub(bridge.aggregator, `http://127.0.0.1:${hubPort}`);

    const controllerEnv = createBridgeEnvironment("sh1-controller", join(root, "controller"), "error");
    controller = await ServerNode.create({
      id: "sh1-controller",
      environment: controllerEnv,
      network: { port: 0 },
      basicInformation: {
        vendorName: "Shroom Labs",
        productName: "CI Controller",
      },
    });
    await controller.start();
  });

  after(async () => {
    if (controller) {
      await controller.close();
    }
    if (bridge?.server) {
      await bridge.server.close();
    }
    if (hub) {
      await new Promise((resolve) => hub.close(resolve));
    }
  });

  it("exposes pairing codes without commissioning, then a controller can read sensors", async () => {
    const beforePair = pairingStatus(bridge.server, 1);
    assert.equal(beforePair.commissioned, false);
    assert.ok(beforePair.qr);
    assert.ok(beforePair.manual_code);
    assert.doesNotMatch(JSON.stringify(beforePair), /38472651/);

    const client = await controller.peers.commission({
      longDiscriminator: identity.discriminator,
      passcode: identity.passcode,
      timeout: Seconds(45),
    });

    assert.ok(client);
    const readings = collectReadings(client);
    const temperatures = readings.map((row) => row.temperature);
    const humidities = readings.map((row) => row.humidity);
    const contacts = readings.map((row) => row.contact);
    assert.ok(temperatures.includes(2250), `temperature missing in ${JSON.stringify(readings)}`);
    assert.ok(humidities.includes(9000), `humidity missing in ${JSON.stringify(readings)}`);
    assert.ok(contacts.includes(false), `open water contact missing in ${JSON.stringify(readings)}`);
    assert.equal(pairingStatus(bridge.server, 1).commissioned, true);
  });
});
