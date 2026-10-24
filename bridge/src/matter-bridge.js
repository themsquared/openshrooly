import { Endpoint, Environment, Logger, ServerNode, VendorId } from "@matter/main";
import { ContactSensorDevice } from "@matter/main/devices/contact-sensor";
import { HumiditySensorDevice } from "@matter/main/devices/humidity-sensor";
import { TemperatureSensorDevice } from "@matter/main/devices/temperature-sensor";
import { AggregatorEndpoint } from "@matter/main/endpoints/aggregator";
import { BridgedNodeEndpoint } from "@matter/main/endpoints/bridged-node";

import { fetchHubState } from "./hub-client.js";
import { PRODUCT_ID, VENDOR_ID, chamberEndpoints, endpointIds } from "./mapping.js";
import { QuietCommissioningServer } from "./quiet-commissioning.js";

export function createBridgeEnvironment(name, storagePath, logLevel = "warn") {
  const env = new Environment(name, Environment.default);
  env.vars.set("storage.path", storagePath);
  env.vars.set("log.level", logLevel);
  env.vars.set("mdns.ipv4", true);
  return env;
}

export async function createMatterBridge({
  identity,
  storagePath,
  port,
  environment,
  logLevel = "warn",
}) {
  Logger.level = logLevel;
  const env = environment || createBridgeEnvironment(`bridge-${identity.uniqueId}`, storagePath, logLevel);

  const server = await ServerNode.create(ServerNode.RootEndpoint.with(QuietCommissioningServer), {
    id: identity.uniqueId,
    environment: env,
    network: { port },
    commissioning: {
      passcode: identity.passcode,
      discriminator: identity.discriminator,
    },
    productDescription: {
      name: "Shroom Labs Hub",
      deviceType: AggregatorEndpoint.deviceType,
    },
    basicInformation: {
      vendorName: "Shroom Labs",
      vendorId: VendorId(VENDOR_ID),
      nodeLabel: "Shroom Labs Hub",
      productName: "Shroom Labs Hub",
      productLabel: "Shroom Labs Hub",
      productId: PRODUCT_ID,
      serialNumber: `sl-hub-${identity.uniqueId}`.slice(0, 32),
      uniqueId: identity.uniqueId,
    },
  });

  const aggregator = new Endpoint(AggregatorEndpoint, { id: "aggregator" });
  await server.add(aggregator);

  return { server, aggregator, env };
}

async function setIfPresent(endpoint, values) {
  if (!endpoint) {
    return;
  }
  await endpoint.set(values);
}

export async function applyChamber(aggregator, chamber) {
  const mapped = chamberEndpoints(chamber);
  const ids = endpointIds(mapped.id);
  let node = aggregator.parts.get(ids.node);
  if (!node) {
    node = new Endpoint(BridgedNodeEndpoint, {
      id: ids.node,
      bridgedDeviceBasicInformation: {
        nodeLabel: mapped.name,
        productName: mapped.name,
        productLabel: mapped.name,
        vendorName: "Shroom Labs",
        serialNumber: `chamber-${mapped.id}`.slice(0, 32),
        reachable: mapped.reachable,
      },
    });
    await aggregator.add(node);
    await node.add(
      new Endpoint(TemperatureSensorDevice, {
        id: ids.temperature,
        temperatureMeasurement: { measuredValue: mapped.temperature },
      }),
    );
    await node.add(
      new Endpoint(HumiditySensorDevice, {
        id: ids.humidity,
        relativeHumidityMeasurement: { measuredValue: mapped.humidity },
      }),
    );
    await node.add(
      new Endpoint(ContactSensorDevice, {
        id: ids.water,
        booleanState: { stateValue: mapped.waterClosed ?? true },
      }),
    );
    return node;
  }

  await setIfPresent(node, {
    bridgedDeviceBasicInformation: {
      reachable: mapped.reachable,
      nodeLabel: mapped.name,
    },
  });
  if (mapped.temperature != null) {
    await setIfPresent(node.parts.get(ids.temperature), {
      temperatureMeasurement: { measuredValue: mapped.temperature },
    });
  }
  if (mapped.humidity != null) {
    await setIfPresent(node.parts.get(ids.humidity), {
      relativeHumidityMeasurement: { measuredValue: mapped.humidity },
    });
  }
  if (mapped.waterClosed != null) {
    await setIfPresent(node.parts.get(ids.water), {
      booleanState: { stateValue: mapped.waterClosed },
    });
  }
  return node;
}

export async function syncChambers(aggregator, chambers) {
  for (const chamber of chambers) {
    await applyChamber(aggregator, chamber);
  }
}

export function pairingStatus(server, chamberCount = 0) {
  const commissioned = Boolean(server.lifecycle.isCommissioned);
  const fabrics = Object.keys(server.state.commissioning.fabrics || {}).length;
  const codes = commissioned ? {} : server.state.commissioning.pairingCodes || {};
  return {
    commissioned,
    fabrics,
    qr: codes.qrPairingCode || null,
    manual_code: codes.manualPairingCode || null,
    vendor_id: "0xFFF1",
    product_id: "0x8000",
    chambers: chamberCount,
  };
}

export async function pollHub(aggregator, hubUrl, fetchImpl) {
  const state = await fetchHubState(hubUrl, fetchImpl);
  await syncChambers(aggregator, state.chambers);
  return state.chambers.length;
}
