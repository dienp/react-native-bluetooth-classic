import { useState } from 'react';
import { Button, Text, View } from 'react-native';
import {
  getAdapterState,
  getCapabilities,
  getConnectedAccessories,
  requestEnable,
  requestPermissions,
} from '@dynlabs/react-native-bluetooth-classic';
import { describeError, styles } from '../styles';

type Result = { label: string; value: unknown };

export function OverviewScreen() {
  const [results, setResults] = useState<Result[]>([]);

  const run = (label: string, action: () => unknown) => async () => {
    let value: unknown;
    try {
      value = await action();
    } catch (error) {
      value = { error: describeError(error) };
    }
    setResults((previous) => [{ label, value }, ...previous]);
  };

  let capabilities: unknown;
  try {
    capabilities = getCapabilities();
  } catch (error) {
    capabilities = { error: describeError(error) };
  }

  return (
    <View>
      <Text style={styles.heading}>Capabilities</Text>
      <Text selectable style={styles.code}>
        {JSON.stringify(capabilities, null, 2)}
      </Text>
      <View style={styles.buttons}>
        <Button
          title="Request permissions"
          onPress={run('requestPermissions', () =>
            requestPermissions('connect')
          )}
        />
        <Button
          title="Adapter state"
          onPress={run('getAdapterState', getAdapterState)}
        />
        <Button
          title="Turn Bluetooth on"
          onPress={run('requestEnable', requestEnable)}
        />
        <Button
          title="Accessories"
          onPress={run('getConnectedAccessories', getConnectedAccessories)}
        />
      </View>
      {results.map((result, index) => (
        <View key={index}>
          <Text style={styles.heading}>{result.label}</Text>
          <Text selectable style={styles.code}>
            {JSON.stringify(result.value, null, 2)}
          </Text>
        </View>
      ))}
    </View>
  );
}
