import { useState } from 'react';
import { Button, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  getAdapterState,
  getBondedDevices,
  getCapabilities,
  getConnectedAccessories,
  isBluetoothClassicError,
  requestPermissions,
} from 'react-native-bluetooth-classic';

type Result = { label: string; value: unknown };

function describe(error: unknown): unknown {
  return isBluetoothClassicError(error) ? error.toJSON() : String(error);
}

export default function App() {
  const [results, setResults] = useState<Result[]>([]);

  const run = (label: string, action: () => unknown) => async () => {
    let value: unknown;
    try {
      value = await action();
    } catch (error) {
      value = { error: describe(error) };
    }
    setResults((previous) => [{ label, value }, ...previous]);
  };

  let capabilities: unknown;
  try {
    capabilities = getCapabilities();
  } catch (error) {
    capabilities = { error: describe(error) };
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>react-native-bluetooth-classic</Text>
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
          title="Bonded devices"
          onPress={run('getBondedDevices', getBondedDevices)}
        />
        <Button
          title="Accessories"
          onPress={run('getConnectedAccessories', getConnectedAccessories)}
        />
      </View>
      {results.map((result, index) => (
        <View key={index} style={styles.result}>
          <Text style={styles.heading}>{result.label}</Text>
          <Text selectable style={styles.code}>
            {JSON.stringify(result.value, null, 2)}
          </Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 24,
    paddingTop: 64,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
  },
  heading: {
    fontWeight: '600',
    marginTop: 12,
  },
  code: {
    fontFamily: 'Courier',
    fontSize: 12,
  },
  buttons: {
    gap: 8,
    marginTop: 16,
  },
  result: {
    marginTop: 8,
  },
});
