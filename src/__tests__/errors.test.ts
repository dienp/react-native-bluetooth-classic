import {
  BluetoothClassicError,
  ERROR_CODES,
  ErrorCode,
  isBluetoothClassicError,
} from '../index';
import { toBluetoothClassicError } from '../errors/normalize';
import { nativeRejection } from '../__fakes__/FakeNativeModule';
import {
  installFakeNativeModule,
  uninstallFakeNativeModule,
} from '../__fakes__/install';

afterEach(() => uninstallFakeNativeModule());

describe('BluetoothClassicError', () => {
  it('is a runtime Error subclass with a code from ErrorCode', () => {
    installFakeNativeModule({ os: 'android', apiLevel: 34 });
    const error = new BluetoothClassicError(
      ErrorCode.CONNECT_TIMEOUT,
      'Timed out'
    );

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(BluetoothClassicError);
    expect(error.name).toBe('BluetoothClassicError');
    expect(error.code).toBe('CONNECT_TIMEOUT');
    expect(error.message).toBe('Timed out');
    expect(error.platform).toBe('android');
  });

  it('exports ErrorCode as a value so codes compare at runtime', () => {
    const error = new BluetoothClassicError(ErrorCode.CONNECT_TIMEOUT);
    expect(error.code === ErrorCode.CONNECT_TIMEOUT).toBe(true);
    expect(ERROR_CODES).toHaveLength(35);
    expect(new Set(ERROR_CODES).size).toBe(35);
  });

  it('always has a non-empty message', () => {
    expect(new BluetoothClassicError(ErrorCode.UNKNOWN).message).toMatch(
      /UNKNOWN/
    );
    expect(new BluetoothClassicError(ErrorCode.UNKNOWN, '').message).not.toBe(
      ''
    );
  });

  it('serializes every context field that is set', () => {
    installFakeNativeModule({ os: 'ios' });
    const error = new BluetoothClassicError(
      ErrorCode.PERMISSION_DENIED,
      'Denied',
      {
        deviceId: 'AA',
        connectionId: 'c1',
        missingPermissions: ['BLUETOOTH_CONNECT'],
        nativeCode: 'SecurityException',
        nativeMessage: 'Need BLUETOOTH_CONNECT',
      }
    );

    expect(JSON.parse(JSON.stringify(error))).toEqual({
      name: 'BluetoothClassicError',
      code: 'PERMISSION_DENIED',
      message: 'Denied',
      platform: 'ios',
      deviceId: 'AA',
      connectionId: 'c1',
      missingPermissions: ['BLUETOOTH_CONNECT'],
      nativeCode: 'SecurityException',
      nativeMessage: 'Need BLUETOOTH_CONNECT',
    });
  });

  it('omits unset fields from JSON', () => {
    const json = new BluetoothClassicError(
      ErrorCode.NOT_CONNECTED,
      'x'
    ).toJSON();
    expect(Object.keys(json).sort()).toEqual([
      'code',
      'message',
      'name',
      'platform',
    ]);
  });
});

describe('isBluetoothClassicError', () => {
  it('narrows by type and optional code', () => {
    const error = new BluetoothClassicError(ErrorCode.CONNECT_FAILED);
    expect(isBluetoothClassicError(error)).toBe(true);
    expect(isBluetoothClassicError(error, ErrorCode.CONNECT_FAILED)).toBe(true);
    expect(isBluetoothClassicError(error, ErrorCode.CONNECT_TIMEOUT)).toBe(
      false
    );
    expect(isBluetoothClassicError(new Error('x'))).toBe(false);
    expect(isBluetoothClassicError({ code: 'CONNECT_FAILED' })).toBe(false);
  });
});

describe('toBluetoothClassicError', () => {
  it('keeps a mapped native code and its user info', () => {
    const error = toBluetoothClassicError(
      nativeRejection('CONNECT_FAILED', 'Connection refused', {
        deviceId: '00:11:22:AA:BB:CC',
        nativeCode: 'IOException',
        nativeMessage: 'read failed, socket might closed',
      })
    );

    expect(error.code).toBe('CONNECT_FAILED');
    expect(error.message).toBe('Connection refused');
    expect(error.deviceId).toBe('00:11:22:AA:BB:CC');
    expect(error.nativeCode).toBe('IOException');
    expect(error.nativeMessage).toBe('read failed, socket might closed');
  });

  it('maps unknown native codes to UNKNOWN and preserves them', () => {
    const error = toBluetoothClassicError(
      nativeRejection('EUNSPECIFIED', 'java.lang.IllegalStateException: boom')
    );

    expect(error.code).toBe('UNKNOWN');
    expect(error.nativeCode).toBe('EUNSPECIFIED');
    expect(error.nativeMessage).toBe('java.lang.IllegalStateException: boom');
  });

  it('maps plain errors and strings to UNKNOWN', () => {
    const fromError = toBluetoothClassicError(new TypeError('bad'));
    expect(fromError.code).toBe('UNKNOWN');
    expect(fromError.nativeCode).toBe('TypeError');
    expect(fromError.nativeMessage).toBe('bad');

    expect(toBluetoothClassicError('oops').nativeMessage).toBe('oops');
    expect(toBluetoothClassicError(undefined).code).toBe('UNKNOWN');
  });

  it('returns BluetoothClassicErrors unchanged', () => {
    const error = new BluetoothClassicError(ErrorCode.NOT_CONNECTED);
    expect(toBluetoothClassicError(error)).toBe(error);
  });

  it('adds call context when the native error lacks it', () => {
    const error = toBluetoothClassicError(
      nativeRejection('PAIRING_FAILED', 'x'),
      {
        deviceId: 'AA:BB',
      }
    );
    expect(error.deviceId).toBe('AA:BB');
  });

  it('copies missingPermissions from user info', () => {
    const error = toBluetoothClassicError(
      nativeRejection('PERMISSION_DENIED', 'x', {
        missingPermissions: ['BLUETOOTH_SCAN'],
      })
    );
    expect(error.missingPermissions).toEqual(['BLUETOOTH_SCAN']);
  });
});
