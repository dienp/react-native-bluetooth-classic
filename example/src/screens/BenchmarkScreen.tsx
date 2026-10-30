import { useEffect, useState } from 'react';
import { Button, Text, View } from 'react-native';
import {
  delimiter,
  getConnections,
  type Connection,
} from '@dynlabs/react-native-bluetooth-classic';
import { describeError, styles } from '../styles';
import { deviceLabel } from './ConnectScreen';

const BLOCK_BYTES = 4 * 1024;
const LATENCY_LINE = 'PING567890\r\n'; // 12 bytes

function now(): number {
  return globalThis.performance?.now() ?? Date.now();
}

function percentile(sorted: readonly number[], p: number): number {
  const index = Math.min(
    sorted.length - 1,
    Math.ceil((p / 100) * sorted.length) - 1
  );
  return sorted[Math.max(0, index)] ?? 0;
}

/**
 * Measures a loopback device on the first open connection: throughput of a
 * bulk transfer, and the round-trip latency of a short line. The device must
 * echo every byte. See docs/hardware-validation.md#benchmark.
 */
export function BenchmarkScreen({
  throughputBytes = 1024 * 1024,
  latencyRounds = 100,
}: {
  throughputBytes?: number;
  latencyRounds?: number;
}) {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [results, setResults] = useState<string[]>([]);
  const [running, setRunning] = useState(false);

  const report = (line: string) =>
    setResults((previous) => [line, ...previous]);

  useEffect(() => {
    getConnections()
      .then(([first]) => setConnection(first ?? null))
      .catch((error) =>
        report(`Failed: ${JSON.stringify(describeError(error))}`)
      );
  }, []);

  const run =
    (name: string, benchmark: (connection: Connection) => Promise<string>) =>
    () => {
      if (connection === null || running) return;
      setRunning(true);
      benchmark(connection)
        .then(report)
        .catch((error) =>
          report(`${name} failed: ${JSON.stringify(describeError(error))}`)
        )
        .finally(() => setRunning(false));
    };

  const throughput = async (target: Connection): Promise<string> => {
    const sent = new Uint8Array(throughputBytes).map((_, index) => index % 251);
    let received = 0;
    let mismatches = 0;
    let finish: () => void = () => {};
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const subscription = target.onData((chunk) => {
      chunk.forEach((byte, offset) => {
        if (byte !== sent[received + offset]) mismatches += 1;
      });
      received += chunk.length;
      if (received >= sent.length) finish();
    });
    try {
      const started = now();
      const writes: Promise<void>[] = [];
      for (let offset = 0; offset < sent.length; offset += BLOCK_BYTES) {
        writes.push(target.write(sent.subarray(offset, offset + BLOCK_BYTES)));
      }
      await Promise.all(writes);
      await done;
      const seconds = (now() - started) / 1000;
      const rate = Math.round(sent.length / 1024 / seconds);
      return `Throughput: ${rate} KiB/s (${sent.length} bytes in ${Math.round(seconds * 1000)} ms, ${mismatches} mismatched)`;
    } finally {
      subscription.remove();
    }
  };

  const latency = async (target: Connection): Promise<string> => {
    const reader = target.createReader({
      framer: delimiter('\r\n'),
      encoding: 'utf8',
    });
    try {
      const times: number[] = [];
      for (let round = 0; round < latencyRounds; round += 1) {
        const started = now();
        await target.write(LATENCY_LINE);
        await reader.read({ timeoutMs: 2_000 });
        times.push(now() - started);
      }
      times.sort((a, b) => a - b);
      const median = percentile(times, 50).toFixed(1);
      const p95 = percentile(times, 95).toFixed(1);
      return `Latency: median ${median} ms, p95 ${p95} ms over ${times.length} round trips`;
    } finally {
      reader.close();
    }
  };

  return (
    <View>
      <Text style={styles.heading}>
        {connection === null
          ? 'No open connection: connect to a loopback device first'
          : `Using ${connection.id} (${deviceLabel(connection.device)})`}
      </Text>
      <View style={styles.buttons}>
        <Button
          title="Measure throughput"
          disabled={connection === null || running}
          onPress={run('Throughput', throughput)}
        />
        <Button
          title="Measure latency"
          disabled={connection === null || running}
          onPress={run('Latency', latency)}
        />
      </View>
      {results.map((line, index) => (
        <Text key={index} selectable style={styles.code}>
          {line}
        </Text>
      ))}
    </View>
  );
}
