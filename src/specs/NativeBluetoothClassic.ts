import { TurboModuleRegistry, type TurboModule } from 'react-native';

export type NativeCapabilities = {
  platform: string;
  osVersion: string;
  discovery: boolean;
  pairing: boolean;
  server: boolean;
  adapterState: boolean;
  requestEnable: boolean;
  bondLossEvents: boolean;
  accessoryPicker: boolean;
  declaredProtocols: string[];
};

export interface Spec extends TurboModule {
  getCapabilities(): NativeCapabilities;
}

export default TurboModuleRegistry.get<Spec>('RNBluetoothClassic');
