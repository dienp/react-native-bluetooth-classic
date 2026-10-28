import { __resetEventHubs } from '../events';
import { __setNativeModuleOverride } from '../native';
import { __setHostPlatformOverride } from '../platform';
import { FakeNativeModule, type FakePlatform } from './FakeNativeModule';

/**
 * Installs a fresh fake native module and emulates its platform. Returns the
 * fake so tests can drive it.
 */
export function installFakeNativeModule(
  platform: FakePlatform = { os: 'android', apiLevel: 36 }
): FakeNativeModule {
  const fake = new FakeNativeModule(platform);
  __resetEventHubs();
  __setNativeModuleOverride(fake);
  __setHostPlatformOverride(platform.os);
  return fake;
}

/** Emulates an app whose native module is not linked. */
export function emulateMissingNativeModule(os: 'android' | 'ios'): void {
  __resetEventHubs();
  __setNativeModuleOverride(null);
  __setHostPlatformOverride(os);
}

/** Emulates a host platform other than Android and iOS (web, Windows). */
export function emulateUnsupportedHost(): void {
  __resetEventHubs();
  __setNativeModuleOverride(null);
  __setHostPlatformOverride('other');
}

/** Restores the real native module and platform. */
export function uninstallFakeNativeModule(): void {
  __resetEventHubs();
  __setNativeModuleOverride(undefined);
  __setHostPlatformOverride(undefined);
}
