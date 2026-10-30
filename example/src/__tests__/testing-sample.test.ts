import {
  connect,
  decodeText,
  delimiter,
  ErrorCode,
} from '@dynlabs/react-native-bluetooth-classic';
import { mock } from '@dynlabs/react-native-bluetooth-classic/jest';

jest.mock('@dynlabs/react-native-bluetooth-classic', () =>
  require('@dynlabs/react-native-bluetooth-classic/jest')
);

const SCALE = '00:11:22:AA:BB:CC';

// The code under test: asks a serial scale for its weight.
async function readWeight(address: string): Promise<number> {
  const connection = await connect(address);
  try {
    const lines = connection.createReader({
      framer: delimiter('\r\n'),
      encoding: 'utf8',
    });
    await connection.write('W\r\n');
    return Number.parseFloat(await lines.read({ timeoutMs: 2_000 }));
  } finally {
    await connection.disconnect();
  }
}

beforeEach(() => {
  mock.reset({ os: 'android', apiLevel: 36 });
  mock.addDevice({ address: SCALE, name: 'Scale', bonded: true });
});

test('reads the weight the scale reports', async () => {
  let connectionId = '';
  // Play the scale: it answers as soon as the link is up.
  mock.onConnectionOpened((id) => {
    connectionId = id;
    mock.pushData(id, '12.5\r\n');
  });

  await expect(readWeight(SCALE)).resolves.toBe(12.5);
  expect(decodeText(mock.writtenBytes(connectionId))).toBe('W\r\n');
});

test('passes on a connect failure', async () => {
  mock.failNext('connect', ErrorCode.CONNECT_FAILED);

  await expect(readWeight(SCALE)).rejects.toMatchObject({
    code: ErrorCode.CONNECT_FAILED,
  });
});
