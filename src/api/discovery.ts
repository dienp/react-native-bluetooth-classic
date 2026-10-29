import { toAndroidDevice } from '../devices';
import { EventHub } from '../events';
import { guard, requirePlatform } from '../internal';
import { getNativeModule } from '../native';
import type {
  AndroidDevice,
  DeviceFoundEvent,
  StartDiscoveryOptions,
  Subscription,
} from '../types';
import { validateOptions, type Schema } from '../validation';

/** Addresses already reported in the running discovery session. */
let sessionSeen: Set<string> | null = null;

const deviceFoundHub = new EventHub('onDeviceFound', {
  filter: (event) => {
    if (sessionSeen === null) {
      return true;
    }
    const address = event.device.address.toUpperCase();
    if (sessionSeen.has(address)) {
      return false;
    }
    sessionSeen.add(address);
    return true;
  },
  map: (event): DeviceFoundEvent =>
    Object.freeze({
      device: toAndroidDevice(event.device),
      timestamp: event.timestamp,
    }),
});

/** Android only. Resolves with every device bonded to the adapter. */
export function getBondedDevices(): Promise<AndroidDevice[]> {
  return guard(async () => {
    requirePlatform('android', 'getBondedDevices()');
    const devices = await getNativeModule().getBondedDevices();
    return devices.map(toAndroidDevice);
  });
}

const START_DISCOVERY_SCHEMA: Schema = {
  timeoutMs: { kind: 'integer', min: 1, max: 120_000 },
};

let discoveryRunning = false;

/**
 * Android only. Runs a discovery session. `onDeviceFound` fires at most once
 * per address; the promise resolves with every device found when the session
 * ends (OS completion, `timeoutMs`, or `cancelDiscovery()`).
 */
export function startDiscovery(
  options?: StartDiscoveryOptions
): Promise<AndroidDevice[]> {
  return guard(async () => {
    requirePlatform('android', 'startDiscovery()');
    const { timeoutMs } = validateOptions<StartDiscoveryOptions>(
      options,
      START_DISCOVERY_SCHEMA
    );
    const native = getNativeModule();
    const ownsSession = !discoveryRunning;
    if (ownsSession) {
      discoveryRunning = true;
      sessionSeen = new Set();
    }
    try {
      const devices = await native.startDiscovery(timeoutMs ?? 0);
      return dedupeByAddress(devices.map(toAndroidDevice));
    } finally {
      if (ownsSession) {
        discoveryRunning = false;
        sessionSeen = null;
      }
    }
  });
}

/** Keeps one entry per address: the last one reported, which is the most recent. */
function dedupeByAddress(devices: AndroidDevice[]): AndroidDevice[] {
  const byAddress = new Map<string, AndroidDevice>();
  for (const device of devices) {
    byAddress.delete(device.address);
    byAddress.set(device.address, device);
  }
  return Array.from(byAddress.values());
}

/** Android only. Stops the running discovery session, if any. */
export function cancelDiscovery(): Promise<void> {
  return guard(async () => {
    requirePlatform('android', 'cancelDiscovery()');
    await getNativeModule().cancelDiscovery();
  });
}

/** Android only. Throws `UNSUPPORTED_ON_PLATFORM` on iOS. */
export function onDeviceFound(
  listener: (event: DeviceFoundEvent) => void
): Subscription {
  requirePlatform('android', 'onDeviceFound()');
  return deviceFoundHub.add(listener);
}
