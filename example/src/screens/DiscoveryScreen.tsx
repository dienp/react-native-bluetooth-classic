import { useState } from 'react';
import { Button, Text, View } from 'react-native';
import {
  cancelDiscovery,
  onDeviceFound,
  requestPermissions,
  startDiscovery,
  type AndroidDevice,
} from '@dynlabs/react-native-bluetooth-classic';
import { describeError, styles } from '../styles';

/** Runs a discovery session and lists devices as the OS reports them. */
export function DiscoveryScreen() {
  const [devices, setDevices] = useState<readonly AndroidDevice[]>([]);
  const [status, setStatus] = useState('Idle');

  const start = async () => {
    setDevices([]);
    setStatus('Discovering…');
    try {
      const subscription = onDeviceFound(({ device }) =>
        setDevices((previous) => [
          ...previous.filter((d) => d.id !== device.id),
          device,
        ])
      );
      try {
        const found = await startDiscovery({ timeoutMs: 15_000 });
        setDevices(found);
        setStatus(`Finished: ${found.length} device(s)`);
      } finally {
        subscription.remove();
      }
    } catch (error) {
      setStatus(`Failed: ${JSON.stringify(describeError(error))}`);
    }
  };

  const permissions = async () => {
    try {
      const result = await requestPermissions('discovery');
      setStatus(`Permissions: ${JSON.stringify(result)}`);
    } catch (error) {
      setStatus(`Failed: ${JSON.stringify(describeError(error))}`);
    }
  };

  return (
    <View>
      <View style={styles.buttons}>
        <Button title="Request discovery permissions" onPress={permissions} />
        <Button title="Start discovery" onPress={start} />
        <Button title="Cancel discovery" onPress={() => cancelDiscovery()} />
      </View>
      <Text style={styles.heading}>{status}</Text>
      {devices.map((device) => (
        <View key={device.id} style={styles.row}>
          <Text>{device.name ?? '(no name)'}</Text>
          <Text style={styles.code}>
            {device.address} · {device.bondState}
            {device.rssi !== undefined ? ` · ${device.rssi} dBm` : ''}
          </Text>
        </View>
      ))}
    </View>
  );
}
