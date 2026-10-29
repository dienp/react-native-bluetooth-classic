import { toAdapterState } from '../devices';
import { EventHub } from '../events';
import { guard, requirePlatform } from '../internal';
import { getNativeModule } from '../native';
import type {
  AdapterState,
  AdapterStateChangeEvent,
  Subscription,
} from '../types';
import { invalidArgument, utf8ByteLength } from '../validation';

const adapterStateHub = new EventHub('onAdapterStateChange', {
  map: (event): AdapterStateChangeEvent =>
    Object.freeze({
      state: toAdapterState(event.state),
      previousState: toAdapterState(event.previousState),
      timestamp: event.timestamp,
    }),
});

/** Android only. Resolves with the adapter state at call time. */
export function getAdapterState(): Promise<AdapterState> {
  return guard(async () => {
    requirePlatform('android', 'getAdapterState()');
    return toAdapterState(await getNativeModule().getAdapterState());
  });
}

/** Android only. Throws `UNSUPPORTED_ON_PLATFORM` on iOS. */
export function onAdapterStateChange(
  listener: (event: AdapterStateChangeEvent) => void
): Subscription {
  requirePlatform('android', 'onAdapterStateChange()');
  return adapterStateHub.add(listener);
}

let pendingEnable: Promise<void> | null = null;

/**
 * Android only. Shows the system prompt to turn Bluetooth on and resolves
 * once the adapter is on. Concurrent calls share one prompt and one result.
 */
export function requestEnable(): Promise<void> {
  if (pendingEnable !== null) {
    return pendingEnable;
  }
  const request = guard(async () => {
    requirePlatform('android', 'requestEnable()');
    await getNativeModule().requestEnable();
  }).finally(() => {
    if (pendingEnable === request) {
      pendingEnable = null;
    }
  });
  pendingEnable = request;
  return request;
}

/**
 * Opens the Bluetooth settings screen on Android, or the app's settings page
 * on iOS.
 */
export function openSettings(): Promise<void> {
  return guard(async () => {
    await getNativeModule().openSettings();
  });
}

const MAX_ADAPTER_NAME_BYTES = 248;

/** Android only. Sets the local adapter's visible name. */
export function setAdapterName(name: string): Promise<void> {
  return guard(async () => {
    requirePlatform('android', 'setAdapterName()');
    if (typeof name !== 'string' || name.length === 0) {
      throw invalidArgument('name must be a non-empty string');
    }
    if (utf8ByteLength(name) > MAX_ADAPTER_NAME_BYTES) {
      throw invalidArgument(
        `name must be at most ${MAX_ADAPTER_NAME_BYTES} UTF-8 bytes`
      );
    }
    await getNativeModule().setAdapterName(name);
  });
}
