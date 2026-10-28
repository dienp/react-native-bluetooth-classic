import { toIosAccessory } from '../devices';
import { EventHub } from '../events';
import { guard, requirePlatform } from '../internal';
import { getNativeModule } from '../native';
import type {
  AccessoryEvent,
  AccessoryPickerOptions,
  IosAccessory,
  Subscription,
} from '../types';
import { validateOptions, type Schema } from '../validation';

const mapAccessoryEvent = (event: {
  accessory: Parameters<typeof toIosAccessory>[0];
  timestamp: number;
}): AccessoryEvent =>
  Object.freeze({
    accessory: toIosAccessory(event.accessory),
    timestamp: event.timestamp,
  });

const accessoryConnectedHub = new EventHub('onAccessoryConnected', {
  map: mapAccessoryEvent,
});

const accessoryDisconnectedHub = new EventHub('onAccessoryDisconnected', {
  map: mapAccessoryEvent,
});

/**
 * iOS only. Resolves with the accessories connected to the OS that support at
 * least one protocol declared in `UISupportedExternalAccessoryProtocols`.
 */
export function getConnectedAccessories(): Promise<IosAccessory[]> {
  return guard(async () => {
    requirePlatform('ios', 'getConnectedAccessories()');
    const accessories = await getNativeModule().getConnectedAccessories();
    return accessories.map(toIosAccessory);
  });
}

const PICKER_SCHEMA: Schema = {
  nameFilter: { kind: 'string' },
};

/**
 * iOS only. Shows the system Bluetooth accessory picker. Resolves when an
 * accessory is selected or already connected; observe `onAccessoryConnected`
 * to get the accessory.
 */
export function showAccessoryPicker(
  options?: AccessoryPickerOptions
): Promise<void> {
  return guard(async () => {
    requirePlatform('ios', 'showAccessoryPicker()');
    const { nameFilter } = validateOptions<AccessoryPickerOptions>(
      options,
      PICKER_SCHEMA
    );
    await getNativeModule().showAccessoryPicker(nameFilter ?? null);
  });
}

/** iOS only. Throws `UNSUPPORTED_ON_PLATFORM` on Android. */
export function onAccessoryConnected(
  listener: (event: AccessoryEvent) => void
): Subscription {
  requirePlatform('ios', 'onAccessoryConnected()');
  return accessoryConnectedHub.add(listener);
}

/** iOS only. Throws `UNSUPPORTED_ON_PLATFORM` on Android. */
export function onAccessoryDisconnected(
  listener: (event: AccessoryEvent) => void
): Subscription {
  requirePlatform('ios', 'onAccessoryDisconnected()');
  return accessoryDisconnectedHub.add(listener);
}
