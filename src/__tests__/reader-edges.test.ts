import { ErrorCode, connect, delimiter, type Framer } from '../index';
import { uninstallFakeNativeModule } from '../__fakes__/install';
import { ADDRESS, androidWithDevice } from './helpers';

afterEach(() => uninstallFakeNativeModule());

async function open() {
  const fake = androidWithDevice();
  const connection = await connect(ADDRESS);
  return { fake, connection };
}

describe('reader edge cases', () => {
  it('rejects a read when its signal aborts, staying usable', async () => {
    const { fake, connection } = await open();
    const reader = connection.createReader({
      framer: delimiter('\n'),
      encoding: 'utf8',
    });
    const controller = new AbortController();
    const pending = reader.read({ signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({
      code: ErrorCode.READ_TIMEOUT,
    });
    fake.pushData(connection.id, 'next\n');
    await expect(reader.read()).resolves.toBe('next');
  });

  it('rejects immediately with an already aborted signal', async () => {
    const { connection } = await open();
    const reader = connection.createReader({ framer: delimiter('\n') });
    const controller = new AbortController();
    controller.abort();
    await expect(
      reader.read({ signal: controller.signal })
    ).rejects.toMatchObject({
      code: ErrorCode.READ_TIMEOUT,
    });
  });

  it('fails the reader when a custom framer throws', async () => {
    const { fake, connection } = await open();
    const broken: Framer = {
      push() {
        throw new Error('bad framer');
      },
      flush: () => [],
      reset: () => {},
    };
    const reader = connection.createReader({ framer: broken });
    fake.pushData(connection.id, 'x');
    await expect(reader.read()).rejects.toMatchObject({
      code: ErrorCode.INVALID_ARGUMENT,
      message: expect.stringContaining('bad framer'),
    });
    expect(connection.state).toBe('connected');
  });

  it('closes the reader when iteration stops early', async () => {
    const { fake, connection } = await open();
    const reader = connection.createReader({
      framer: delimiter('\n'),
      encoding: 'utf8',
    });
    fake.pushData(connection.id, 'a\nb\n');
    for await (const frame of reader) {
      expect(frame).toBe('a');
      break;
    }
    await expect(reader.read()).rejects.toMatchObject({
      code: ErrorCode.NOT_CONNECTED,
    });
  });

  it('creates an ended reader after the connection ended', async () => {
    const { fake, connection } = await open();
    fake.failConnection(connection.id, ErrorCode.WRITE_FAILED);
    const reader = connection.createReader({ framer: delimiter('\n') });
    await expect(reader.read()).rejects.toMatchObject({
      code: ErrorCode.WRITE_FAILED,
    });
  });

  it('delivers queued frames before reporting the end', async () => {
    const { fake, connection } = await open();
    const reader = connection.createReader({
      framer: delimiter('\n'),
      encoding: 'utf8',
    });
    fake.pushData(connection.id, 'last\n');
    fake.remoteClose(connection.id);
    await expect(reader.read()).resolves.toBe('last');
    await expect(reader.read()).rejects.toMatchObject({
      code: ErrorCode.NOT_CONNECTED,
    });
  });

  it('ignores data after the connection ended', async () => {
    const { fake, connection } = await open();
    const listener = jest.fn();
    connection.onData(listener);
    fake.onConnectionStateChange.emit({
      connectionId: connection.id,
      state: 'disconnected',
      previousState: 'connected',
      reason: 'remote',
      timestamp: Date.now(),
    });
    fake.onData.emit({ connectionId: connection.id, data: 'AA==', seq: 0 });
    expect(listener).not.toHaveBeenCalled();
  });
});
