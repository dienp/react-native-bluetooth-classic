import { useEffect, useRef, useState } from 'react';
import { Button, Switch, Text, TextInput, View } from 'react-native';
import {
  accept,
  cancelAccept,
  connect,
  getConnections,
  type Connection,
  type Device,
} from '@dynlabs/react-native-bluetooth-classic';
import { describeError, styles } from '../styles';

export function deviceLabel(device: Device): string {
  return device.name ?? device.id;
}

/** Connects by address or accepts an incoming link (Android), and lists open connections. */
export function ConnectScreen() {
  const [address, setAddress] = useState('');
  const [insecure, setInsecure] = useState(false);
  const [channel, setChannel] = useState('');
  const [open, setOpen] = useState<readonly Connection[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const pending = useRef<AbortController | null>(null);

  const append = (line: string) => setLog((previous) => [line, ...previous]);
  const refresh = async () => setOpen(await getConnections());

  useEffect(() => {
    refresh().catch((error) =>
      append(`Failed: ${JSON.stringify(describeError(error))}`)
    );
    return () => pending.current?.abort();
  }, []);

  const track = (connection: Connection) => {
    connection.onStateChange(({ previousState, state }) =>
      append(`${connection.id}: ${previousState} → ${state}`)
    );
    connection.onDisconnected(({ reason, error }) => {
      append(
        `${connection.id} ended: ${reason}${error ? ` (${error.code})` : ''}`
      );
      refresh().catch(() => {});
    });
  };

  // Fire and forget: a pending connect or accept must not block the press.
  const attempt = (action: () => Promise<void>) => () => {
    action().catch((error) =>
      append(`Failed: ${JSON.stringify(describeError(error))}`)
    );
  };

  const onConnect = attempt(async () => {
    const controller = new AbortController();
    pending.current = controller;
    const fallbackChannel = channel === '' ? undefined : Number(channel);
    try {
      const connection = await connect(address, {
        signal: controller.signal,
        android: {
          transport: insecure ? 'insecure' : 'secure',
          ...(fallbackChannel !== undefined && { fallbackChannel }),
        },
      });
      track(connection);
      append(`Connected ${connection.id} to ${deviceLabel(connection.device)}`);
      await refresh();
    } finally {
      pending.current = null;
    }
  });

  const onAccept = attempt(async () => {
    append('Waiting for an incoming connection…');
    const connection = await accept({ serviceName: 'RNBC example' });
    track(connection);
    append(`Accepted ${connection.id} from ${deviceLabel(connection.device)}`);
    await refresh();
  });

  return (
    <View>
      <TextInput
        autoCapitalize="characters"
        onChangeText={setAddress}
        placeholder="00:11:22:AA:BB:CC"
        style={styles.input}
        value={address}
      />
      <View style={styles.switchRow}>
        <Text>Insecure transport</Text>
        <Switch value={insecure} onValueChange={setInsecure} />
      </View>
      <TextInput
        keyboardType="number-pad"
        onChangeText={setChannel}
        placeholder="Fallback channel (optional, 1-30)"
        style={styles.input}
        value={channel}
      />
      <View style={styles.buttons}>
        <Button title="Connect" onPress={onConnect} />
        <Button
          title="Cancel connect"
          onPress={() => pending.current?.abort()}
        />
        <Button title="Accept" onPress={onAccept} />
        <Button title="Cancel accept" onPress={attempt(cancelAccept)} />
      </View>
      <Text style={styles.heading}>Open connections</Text>
      {open.map((connection) => (
        <View key={connection.id} style={styles.row}>
          <Text>
            {connection.id}: {deviceLabel(connection.device)}
          </Text>
          <Button
            title={`Disconnect ${connection.id}`}
            onPress={attempt(() => connection.disconnect())}
          />
        </View>
      ))}
      {log.map((line, index) => (
        <Text key={index} style={styles.code}>
          {line}
        </Text>
      ))}
    </View>
  );
}
