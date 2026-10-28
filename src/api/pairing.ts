import { toAndroidDevice, toBondState } from '../devices';
import { EventHub } from '../events';
import { guard, requirePlatform } from '../internal';
import { getNativeModule } from '../native';
import type {
  AndroidDevice,
  BondLostEvent,
  BondStateChangeEvent,
  PairOptions,
  Subscription,
} from '../types';
import { normalizeAddress, validateOptions, type Schema } from '../validation';

const DEFAULT_PAIR_TIMEOUT_MS = 60_000;

const PAIR_SCHEMA: Schema = {
  timeoutMs: { kind: 'integer', min: 1, max: 600_000 },
};

const bondStateHub = new EventHub('onBondStateChange', {
  map: (event): BondStateChangeEvent =>
    Object.freeze({
      device: toAndroidDevice(event.device),
      state: toBondState(event.state),
      previousState: toBondState(event.previousState),
      timestamp: event.timestamp,
    }),
});

const bondLostHub = new EventHub('onBondLost', {
  map: (event): BondLostEvent =>
    Object.freeze({
      device: toAndroidDevice(event.device),
      timestamp: event.timestamp,
    }),
});

/**
 * Android only. Bonds with `address` through the system pairing UI and
 * resolves with the bonded device.
 */
export function pair(
  address: string,
  options?: PairOptions
): Promise<AndroidDevice> {
  return guard(async () => {
    requirePlatform('android', 'pair()');
    const normalized = normalizeAddress(address);
    const { timeoutMs } = validateOptions<PairOptions>(options, PAIR_SCHEMA);
    const device = await getNativeModule().pair(
      normalized,
      timeoutMs ?? DEFAULT_PAIR_TIMEOUT_MS
    );
    return toAndroidDevice(device);
  }, deviceContext(address));
}

/** Android only. Removes the bond with `address`. */
export function unpair(address: string): Promise<void> {
  return guard(async () => {
    requirePlatform('android', 'unpair()');
    await getNativeModule().unpair(normalizeAddress(address));
  }, deviceContext(address));
}

/** Android only. Throws `UNSUPPORTED_ON_PLATFORM` on iOS. */
export function onBondStateChange(
  listener: (event: BondStateChangeEvent) => void
): Subscription {
  requirePlatform('android', 'onBondStateChange()');
  return bondStateHub.add(listener);
}

/**
 * Android only. Fires on API 36 and later when a remote device lost its
 * bonding keys; check `getCapabilities().bondLossEvents`.
 */
export function onBondLost(
  listener: (event: BondLostEvent) => void
): Subscription {
  requirePlatform('android', 'onBondLost()');
  return bondLostHub.add(listener);
}

function deviceContext(address: unknown): { deviceId?: string } {
  return typeof address === 'string' ? { deviceId: address.toUpperCase() } : {};
}
