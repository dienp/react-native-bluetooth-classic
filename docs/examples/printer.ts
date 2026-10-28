import {
  ErrorCode,
  connect,
  delimiter,
  isBluetoothClassicError,
} from '@dynlabs/react-native-bluetooth-classic';

/** Sends an ESC/POS receipt to a paired Android printer, then disconnects. */
export async function printReceipt(
  address: string,
  lines: string[]
): Promise<void> {
  const connection = await connect(address, {
    timeoutMs: 10_000,
    android: { transport: 'secure' },
  });
  try {
    await connection.write(new Uint8Array([0x1b, 0x40])); // ESC @: initialize
    await connection.write(lines.join('\n') + '\n\n\n', { encoding: 'latin1' });
  } finally {
    // Queued writes finish before the link closes.
    await connection.disconnect();
  }
}

/** Sends a command and waits up to one second for a CRLF-terminated reply. */
export async function query(
  address: string,
  command: string
): Promise<string | null> {
  const connection = await connect(address);
  const reader = connection.createReader({
    framer: delimiter('\r\n'),
    encoding: 'ascii',
  });
  try {
    await connection.write(command + '\r\n', { encoding: 'ascii' });
    return await reader.read({ timeoutMs: 1000 });
  } catch (error) {
    if (isBluetoothClassicError(error, ErrorCode.READ_TIMEOUT)) {
      return null; // The connection is still open; the device did not answer.
    }
    throw error;
  } finally {
    reader.close();
    await connection.disconnect();
  }
}
