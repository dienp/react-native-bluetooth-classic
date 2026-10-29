import { getNativeModule } from '../native';
import { hostPlatform } from '../platform';
import type { Capabilities } from '../types';

const NONE: Capabilities = Object.freeze({
  platform: 'other',
  osVersion: '',
  discovery: false,
  pairing: false,
  server: false,
  adapterState: false,
  requestEnable: false,
  bondLossEvents: false,
  accessoryPicker: false,
  declaredProtocols: Object.freeze([]),
});

/**
 * What the current platform can do. Synchronous; throws `MODULE_NOT_LINKED`
 * when the native module is missing on Android or iOS.
 */
export function getCapabilities(): Capabilities {
  const platform = hostPlatform();
  if (platform === 'other') {
    return NONE;
  }
  const native = getNativeModule().getCapabilities();
  return Object.freeze({
    platform,
    osVersion: native.osVersion,
    discovery: native.discovery,
    pairing: native.pairing,
    server: native.server,
    adapterState: native.adapterState,
    requestEnable: native.requestEnable,
    bondLossEvents: native.bondLossEvents,
    accessoryPicker: native.accessoryPicker,
    declaredProtocols: Object.freeze([...native.declaredProtocols]),
  });
}
