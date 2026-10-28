// Not a test file (testMatch only picks *.test.ts); shared helpers.
import type { FakeNativeModule } from '../__fakes__/FakeNativeModule';
import { installFakeNativeModule } from '../__fakes__/install';

export const ADDRESS = '00:11:22:AA:BB:CC';

export function androidWithDevice(apiLevel = 36): FakeNativeModule {
  const fake = installFakeNativeModule({ os: 'android', apiLevel });
  fake.addDevice({ address: ADDRESS, bonded: true });
  return fake;
}

export function iosWithAccessory(): { fake: FakeNativeModule; id: string } {
  const fake = installFakeNativeModule({ os: 'ios', version: '27.0' });
  fake.declaredProtocols = ['com.acme.serial', 'com.acme.update'];
  const id = fake.connectAccessory({
    id: '42',
    name: 'Scanner',
    protocolStrings: ['com.acme.update'],
  });
  return { fake, id };
}

/** Lets pending promise callbacks and zero-delay timers run. */
export function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
