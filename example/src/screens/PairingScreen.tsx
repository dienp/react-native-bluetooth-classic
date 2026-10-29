import { useEffect, useState } from 'react';
import { Button, Text, TextInput, View } from 'react-native';
import {
  getBondedDevices,
  onBondStateChange,
  pair,
  unpair,
  type AndroidDevice,
} from '@dynlabs/react-native-bluetooth-classic';
import { describeError, styles } from '../styles';

/** Lists bonded devices, pairs by address, and logs bond state changes. */
export function PairingScreen() {
  const [bonded, setBonded] = useState<readonly AndroidDevice[]>([]);
  const [address, setAddress] = useState('');
  const [log, setLog] = useState<string[]>([]);

  const append = (line: string) => setLog((previous) => [line, ...previous]);

  useEffect(() => {
    try {
      const subscription = onBondStateChange(
        ({ device, previousState, state }) =>
          append(`${device.address}: ${previousState} → ${state}`)
      );
      return () => subscription.remove();
    } catch (error) {
      append(
        `Bond events unavailable: ${JSON.stringify(describeError(error))}`
      );
      return undefined;
    }
  }, []);

  const attempt = (action: () => Promise<void>) => async () => {
    try {
      await action();
    } catch (error) {
      append(`Failed: ${JSON.stringify(describeError(error))}`);
    }
  };

  const refresh = attempt(async () => setBonded(await getBondedDevices()));

  return (
    <View>
      <View style={styles.buttons}>
        <Button title="Refresh bonded devices" onPress={refresh} />
      </View>
      {bonded.map((device) => (
        <View key={device.id} style={styles.row}>
          <Text>{device.name ?? '(no name)'}</Text>
          <Text style={styles.code}>{device.address}</Text>
          <Button
            title={`Unpair ${device.address}`}
            onPress={attempt(async () => {
              await unpair(device.address);
              append(`Unpaired ${device.address}`);
              await refresh();
            })}
          />
        </View>
      ))}
      <TextInput
        autoCapitalize="characters"
        onChangeText={setAddress}
        placeholder="00:11:22:AA:BB:CC"
        style={styles.input}
        value={address}
      />
      <View style={styles.buttons}>
        <Button
          title="Pair"
          onPress={attempt(async () => {
            const device = await pair(address);
            append(`Paired with ${device.name ?? device.address}`);
            await refresh();
          })}
        />
      </View>
      {log.map((line, index) => (
        <Text key={index} style={styles.code}>
          {line}
        </Text>
      ))}
    </View>
  );
}
