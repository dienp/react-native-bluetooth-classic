import {
  ErrorCode,
  onAccessoryConnected,
  onAdapterStateChange,
  onBondLost,
  onBondStateChange,
  onDeviceFound,
} from '../index';
import {
  installFakeNativeModule,
  uninstallFakeNativeModule,
} from '../__fakes__/install';

afterEach(() => {
  jest.restoreAllMocks();
  uninstallFakeNativeModule();
});

describe('typed event subscriptions', () => {
  it('delivers events to every listener, in order', () => {
    const fake = installFakeNativeModule();
    const first: string[] = [];
    const second: string[] = [];
    onAdapterStateChange((e) => first.push(e.state));
    onAdapterStateChange((e) => second.push(e.state));

    fake.setAdapterState('turningOff');
    fake.setAdapterState('off');

    expect(first).toEqual(['turningOff', 'off']);
    expect(second).toEqual(['turningOff', 'off']);
  });

  it('makes remove() idempotent and leaves other listeners alone', () => {
    const fake = installFakeNativeModule();
    const a = jest.fn();
    const b = jest.fn();
    const subA = onAdapterStateChange(a);
    onAdapterStateChange(b);

    subA.remove();
    subA.remove();
    fake.setAdapterState('off');

    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('only delivers events emitted after subscribing', () => {
    const fake = installFakeNativeModule();
    fake.setAdapterState('off');
    const listener = jest.fn();
    onAdapterStateChange(listener);
    expect(listener).not.toHaveBeenCalled();
  });

  it('isolates a throwing listener', () => {
    const fake = installFakeNativeModule();
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const healthy = jest.fn();
    onAdapterStateChange(() => {
      throw new Error('listener bug');
    });
    onAdapterStateChange(healthy);

    fake.setAdapterState('off');

    expect(healthy).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(
      '[react-native-bluetooth-classic]',
      'A listener for onAdapterStateChange threw:',
      expect.any(Error)
    );
  });

  it('releases the native subscription when the last listener is removed', () => {
    const fake = installFakeNativeModule();
    const sub1 = onAdapterStateChange(() => {});
    const sub2 = onAdapterStateChange(() => {});
    expect(fake.onAdapterStateChange.listenerCount).toBe(1);
    sub1.remove();
    expect(fake.onAdapterStateChange.listenerCount).toBe(1);
    sub2.remove();
    expect(fake.onAdapterStateChange.listenerCount).toBe(0);
  });

  it('delivers frozen payloads with epoch-millisecond timestamps', () => {
    const fake = installFakeNativeModule();
    const listener = jest.fn();
    onAdapterStateChange(listener);
    fake.setAdapterState('off');

    const event = listener.mock.calls[0][0];
    expect(Object.isFrozen(event)).toBe(true);
    expect(event).toEqual({
      state: 'off',
      previousState: 'on',
      timestamp: expect.any(Number),
    });
    expect(Number.isFinite(event.timestamp)).toBe(true);
  });

  it('rejects non-function listeners', () => {
    installFakeNativeModule();
    expect(() => onAdapterStateChange('x' as never)).toThrow(
      expect.objectContaining({ code: ErrorCode.INVALID_ARGUMENT })
    );
  });

  it.each([
    ['onAdapterStateChange', onAdapterStateChange],
    ['onDeviceFound', onDeviceFound],
    ['onBondStateChange', onBondStateChange],
    ['onBondLost', onBondLost],
  ] as const)(
    'throws UNSUPPORTED_ON_PLATFORM for %s on iOS',
    (_name, subscribe) => {
      installFakeNativeModule({ os: 'ios' });
      expect(() => subscribe(() => {})).toThrow(
        expect.objectContaining({ code: ErrorCode.UNSUPPORTED_ON_PLATFORM })
      );
    }
  );

  it('throws UNSUPPORTED_ON_PLATFORM for accessory events on Android', () => {
    installFakeNativeModule();
    expect(() => onAccessoryConnected(() => {})).toThrow(
      expect.objectContaining({ code: ErrorCode.UNSUPPORTED_ON_PLATFORM })
    );
  });
});
