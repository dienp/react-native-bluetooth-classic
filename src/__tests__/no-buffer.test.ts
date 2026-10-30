import {
  connect,
  decodeText,
  delimiter,
  encodeText,
  fromBase64,
  fromHex,
  toBase64,
  toHex,
} from '../index';
import { uninstallFakeNativeModule } from '../__fakes__/install';
import { ADDRESS, androidWithDevice } from './helpers';

// Node always defines Buffer; React Native does not. Remove it, so any use
// of it in the library fails this test instead of passing unnoticed.
const realBuffer = (globalThis as { Buffer?: unknown }).Buffer;

beforeEach(() => {
  delete (globalThis as { Buffer?: unknown }).Buffer;
});

afterEach(() => {
  (globalThis as { Buffer?: unknown }).Buffer = realBuffer;
  uninstallFakeNativeModule();
});

test('every data API works without a Buffer global', async () => {
  expect((globalThis as { Buffer?: unknown }).Buffer).toBeUndefined();
  expect(fromHex('1b40')).toEqual(new Uint8Array([0x1b, 0x40]));
  expect(toHex(new Uint8Array([0x1b, 0x40]))).toBe('1b40');
  expect(fromBase64(toBase64(new Uint8Array([0, 255, 7])))).toEqual(
    new Uint8Array([0, 255, 7])
  );
  expect(decodeText(encodeText('café', 'utf8'), 'utf8')).toBe('café');

  const fake = androidWithDevice();
  const connection = await connect(ADDRESS);
  const reader = connection.createReader({
    framer: delimiter('\r\n'),
    encoding: 'utf8',
  });
  await connection.write('PING\r\n');
  fake.pushData(connection.id, 'PONG\r\n');

  await expect(reader.read()).resolves.toBe('PONG');
  expect(decodeText(fake.writtenBytes(connection.id))).toBe('PING\r\n');
});
