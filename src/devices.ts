import type {
  NativeAccessory,
  NativeAndroidDevice,
} from './specs/NativeBluetoothClassic';
import type {
  AdapterState,
  AndroidDevice,
  BondState,
  DeviceType,
  IosAccessory,
} from './types';

const BOND_STATES: readonly BondState[] = ['none', 'bonding', 'bonded'];
const DEVICE_TYPES: readonly DeviceType[] = [
  'classic',
  'le',
  'dual',
  'unknown',
];
const ADAPTER_STATES: readonly AdapterState[] = [
  'unavailable',
  'off',
  'turningOn',
  'on',
  'turningOff',
];

export function toBondState(value: string): BondState {
  return (BOND_STATES as readonly string[]).includes(value)
    ? (value as BondState)
    : 'none';
}

export function toAdapterState(value: string): AdapterState {
  return (ADAPTER_STATES as readonly string[]).includes(value)
    ? (value as AdapterState)
    : 'unavailable';
}

export function toAndroidDevice(native: NativeAndroidDevice): AndroidDevice {
  const address = native.address.toUpperCase();
  const device: {
    -readonly [K in keyof AndroidDevice]: AndroidDevice[K];
  } = {
    id: address,
    address,
    name: native.name ?? null,
    bondState: toBondState(native.bondState),
    type: (DEVICE_TYPES as readonly string[]).includes(native.type)
      ? (native.type as DeviceType)
      : 'unknown',
    deviceClass:
      native.deviceClass != null
        ? Object.freeze({
            major: native.deviceClass.major,
            value: native.deviceClass.value,
          })
        : null,
  };
  if (typeof native.rssi === 'number') {
    device.rssi = native.rssi;
  }
  return Object.freeze(device);
}

export function toIosAccessory(native: NativeAccessory): IosAccessory {
  return Object.freeze({
    id: native.id,
    name: native.name,
    manufacturer: native.manufacturer,
    modelNumber: native.modelNumber,
    serialNumber: native.serialNumber,
    firmwareRevision: native.firmwareRevision,
    hardwareRevision: native.hardwareRevision,
    protocolStrings: Object.freeze([...native.protocolStrings]),
  });
}
