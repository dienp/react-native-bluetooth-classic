import { Platform } from 'react-native';

export type HostPlatform = 'android' | 'ios' | 'other';

let override: HostPlatform | undefined;

/** The platform the library is running on, read at call time. */
export function hostPlatform(): HostPlatform {
  if (override !== undefined) {
    return override;
  }
  const os = Platform.OS;
  return os === 'android' || os === 'ios' ? os : 'other';
}

/**
 * @internal Used by the Jest mock to emulate a platform. Pass `undefined` to
 * restore the real platform.
 */
export function __setHostPlatformOverride(
  platform: HostPlatform | undefined
): void {
  override = platform;
}
