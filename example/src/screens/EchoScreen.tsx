import { useEffect, useState } from 'react';
import { Button, Text, TextInput, View } from 'react-native';
import {
  delimiter,
  getConnections,
  type Connection,
} from '@dynlabs/react-native-bluetooth-classic';
import { describeError, styles } from '../styles';
import { deviceLabel } from './ConnectScreen';

const LINE_END = '\r\n';
const ECHO_TIMEOUT_MS = 5_000;

function randomLine(length: number): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from(
    { length },
    () => alphabet[Math.floor(Math.random() * alphabet.length)]
  ).join('');
}

/**
 * Sends lines over the first open connection and shows the lines it
 * receives. The echo test expects a loopback device that returns every byte.
 */
export function EchoScreen() {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [text, setText] = useState('');
  const [lines, setLines] = useState<string[]>([]);
  const [status, setStatus] = useState('');

  const append = (line: string) => setLines((previous) => [line, ...previous]);

  const pickFirst = async () => {
    try {
      const [first] = await getConnections();
      setConnection(first ?? null);
      setStatus(
        first
          ? `Using ${first.id} (${deviceLabel(first.device)})`
          : 'No open connection: connect on the Connect screen first'
      );
    } catch (error) {
      setStatus(`Failed: ${JSON.stringify(describeError(error))}`);
    }
  };

  useEffect(() => {
    pickFirst();
  }, []);

  useEffect(() => {
    if (connection === null) return undefined;
    const reader = connection.createReader({
      framer: delimiter(LINE_END),
      encoding: 'utf8',
    });
    (async () => {
      try {
        for await (const line of reader) append(`← ${line}`);
        append(`${connection.id} closed`);
      } catch (error) {
        append(`Read failed: ${JSON.stringify(describeError(error))}`);
      }
    })();
    return () => reader.close();
  }, [connection]);

  const send = async () => {
    if (connection === null) return;
    try {
      await connection.write(text + LINE_END);
      append(`→ ${text}`);
    } catch (error) {
      append(`Write failed: ${JSON.stringify(describeError(error))}`);
    }
  };

  const echoTest = async () => {
    if (connection === null) return;
    const payload = randomLine(64);
    // A second reader sees only bytes that arrive after it attaches.
    const reader = connection.createReader({
      framer: delimiter(LINE_END),
      encoding: 'utf8',
    });
    try {
      const started = Date.now();
      await connection.write(payload + LINE_END);
      const reply = await reader.read({ timeoutMs: ECHO_TIMEOUT_MS });
      setStatus(
        reply === payload
          ? `Echo OK: ${payload.length + LINE_END.length} bytes in ${Date.now() - started} ms`
          : `Echo mismatch: sent ${payload}, received ${reply}`
      );
    } catch (error) {
      setStatus(`Echo failed: ${JSON.stringify(describeError(error))}`);
    } finally {
      reader.close();
    }
  };

  return (
    <View>
      <View style={styles.buttons}>
        <Button
          title="Use first open connection"
          onPress={() => {
            pickFirst();
          }}
        />
      </View>
      <Text style={styles.heading}>{status}</Text>
      <TextInput
        onChangeText={setText}
        placeholder="Text to send"
        style={styles.input}
        value={text}
      />
      <View style={styles.buttons}>
        <Button
          title="Send"
          disabled={connection === null}
          onPress={() => {
            send();
          }}
        />
        <Button
          title="Run echo test"
          disabled={connection === null}
          onPress={() => {
            echoTest();
          }}
        />
      </View>
      {lines.map((line, index) => (
        <Text key={index} style={styles.code}>
          {line}
        </Text>
      ))}
    </View>
  );
}
