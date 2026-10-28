import {
  Connection,
  ErrorCode,
  accept,
  cancelAccept,
  connect,
  getConnection,
  getConnections,
  startDiscovery,
  type ConnectionStateEvent,
  type DisconnectedEvent,
} from '../index';
import { uninstallFakeNativeModule } from '../__fakes__/install';
import { ADDRESS, androidWithDevice, flush, iosWithAccessory } from './helpers';

afterEach(() => uninstallFakeNativeModule());

describe('connect on Android', () => {
  it('resolves with a connected Connection', async () => {
    const fake = androidWithDevice();
    const connection = await connect(ADDRESS.toLowerCase());

    expect(connection).toBeInstanceOf(Connection);
    expect(connection.state).toBe('connected');
    expect(connection.device).toMatchObject({
      id: ADDRESS,
      bondState: 'bonded',
    });
    expect(typeof connection.id).toBe('string');
    expect(Number.isFinite(connection.connectedAt)).toBe(true);
    const call = fake.calls.find((c) => c.method === 'connect');
    expect(call?.args[1]).toBe(ADDRESS);
    expect(call?.args[2]).toEqual({ timeoutMs: 15_000 });
  });

  it('passes only Android options, flattened', async () => {
    const fake = androidWithDevice();
    await connect(ADDRESS, {
      timeoutMs: 8000,
      android: {
        transport: 'insecure',
        uuid: '00001101-0000-1000-8000-00805F9B34FB',
        fallbackChannel: 1,
      },
      ios: { protocol: 'com.acme.serial' },
    });
    expect(fake.calls.find((c) => c.method === 'connect')?.args[2]).toEqual({
      timeoutMs: 8000,
      transport: 'insecure',
      uuid: '00001101-0000-1000-8000-00805F9B34FB',
      fallbackChannel: 1,
    });
  });

  it('cancels a running discovery first', async () => {
    const fake = androidWithDevice();
    const discovery = startDiscovery();
    await flush();
    await connect(ADDRESS);
    await expect(discovery).resolves.toHaveLength(1);
    const methods = fake.calls.map((c) => c.method);
    expect(methods.indexOf('connect')).toBeGreaterThan(
      methods.indexOf('startDiscovery')
    );
  });

  it('rejects with CONNECT_FAILED and the OS reason', async () => {
    const fake = androidWithDevice();
    fake.connectResponses.set(ADDRESS, 'fail');
    await expect(connect(ADDRESS)).rejects.toMatchObject({
      code: ErrorCode.CONNECT_FAILED,
      deviceId: ADDRESS,
      nativeMessage: expect.stringContaining('read failed'),
    });
  });

  it('rejects with CONNECT_TIMEOUT', async () => {
    jest.useFakeTimers();
    try {
      const fake = androidWithDevice();
      fake.connectResponses.set(ADDRESS, 'hang');
      const outcome = connect(ADDRESS, { timeoutMs: 1000 }).catch(
        (e: unknown) => e
      );
      await jest.advanceTimersByTimeAsync(1000);
      expect(await outcome).toMatchObject({ code: ErrorCode.CONNECT_TIMEOUT });
      await expect(getConnections()).resolves.toEqual([]);
    } finally {
      jest.useRealTimers();
    }
  });

  it('rejects with BLUETOOTH_DISABLED when the adapter is off', async () => {
    const fake = androidWithDevice();
    fake.adapterState = 'off';
    await expect(connect(ADDRESS)).rejects.toMatchObject({
      code: ErrorCode.BLUETOOTH_DISABLED,
    });
  });

  it.each([
    ['not-an-address', undefined, /deviceId/],
    [ADDRESS, { timeoutMs: -1 }, /timeoutMs/],
    [ADDRESS, { DELIMITER: '\n' }, /DELIMITER/],
    [ADDRESS, { android: { transport: 'fast' } }, /android\.transport/],
    [ADDRESS, { android: { uuid: 'spp' } }, /android\.uuid/],
    [ADDRESS, { maxBufferBytes: 10 }, /maxBufferBytes/],
    [ADDRESS, { signal: {} }, /signal/],
  ])(
    'rejects connect(%j, %j) with INVALID_ARGUMENT',
    async (id, options, message) => {
      const fake = androidWithDevice();
      await expect(connect(id, options as never)).rejects.toMatchObject({
        code: ErrorCode.INVALID_ARGUMENT,
        message: expect.stringMatching(message),
      });
      expect(fake.calls.filter((c) => c.method === 'connect')).toEqual([]);
    }
  );
});

describe('connect on iOS', () => {
  it('uses the first declared protocol the accessory supports', async () => {
    const { fake, id } = iosWithAccessory();
    const connection = await connect(id, {
      android: { transport: 'insecure' },
    });
    expect(connection.protocol).toBe('com.acme.update');
    expect(connection.device).toMatchObject({ id: '42', name: 'Scanner' });
    expect(fake.calls.find((c) => c.method === 'connect')?.args[2]).toEqual({
      timeoutMs: 15_000,
    });
  });

  it('passes an explicit protocol', async () => {
    const { fake, id } = iosWithAccessory();
    await connect(id, { ios: { protocol: 'com.acme.update' } });
    expect(fake.calls.find((c) => c.method === 'connect')?.args[2]).toEqual({
      timeoutMs: 15_000,
      protocol: 'com.acme.update',
    });
  });

  it.each([
    ['com.acme.other', ErrorCode.PROTOCOL_NOT_DECLARED],
    ['com.acme.serial', ErrorCode.PROTOCOL_NOT_SUPPORTED],
  ])('rejects protocol %s with %s', async (protocol, code) => {
    const { id } = iosWithAccessory();
    await expect(connect(id, { ios: { protocol } })).rejects.toMatchObject({
      code,
    });
  });

  it('rejects an accessory that is not connected', async () => {
    iosWithAccessory();
    await expect(connect('7')).rejects.toMatchObject({
      code: ErrorCode.ACCESSORY_NOT_CONNECTED,
    });
  });

  it('rejects with SESSION_OPEN_FAILED when the OS refuses', async () => {
    const { fake, id } = iosWithAccessory();
    fake.connectResponses.set(id, 'sessionFail');
    await expect(connect(id)).rejects.toMatchObject({
      code: ErrorCode.SESSION_OPEN_FAILED,
    });
  });
});

describe('one active connection per target', () => {
  it('rejects ALREADY_CONNECTED with the existing connection id', async () => {
    androidWithDevice();
    const first = await connect(ADDRESS);
    await expect(connect(ADDRESS)).rejects.toMatchObject({
      code: ErrorCode.ALREADY_CONNECTED,
      connectionId: first.id,
    });
    expect(first.state).toBe('connected');
  });

  it('rejects ALREADY_CONNECTING for concurrent attempts', async () => {
    androidWithDevice();
    const first = connect(ADDRESS);
    await expect(connect(ADDRESS)).rejects.toMatchObject({
      code: ErrorCode.ALREADY_CONNECTING,
    });
    await expect(first).resolves.toBeInstanceOf(Connection);
  });
});

describe('cancelling a pending connect', () => {
  it('rejects with CONNECT_CANCELLED and leaves no connection', async () => {
    const fake = androidWithDevice();
    fake.connectResponses.set(ADDRESS, 'hang');
    const controller = new AbortController();
    const pending = connect(ADDRESS, { signal: controller.signal });
    await flush();
    controller.abort();
    await expect(pending).rejects.toMatchObject({
      code: ErrorCode.CONNECT_CANCELLED,
    });
    await expect(getConnections()).resolves.toEqual([]);
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const fake = androidWithDevice();
    const controller = new AbortController();
    controller.abort();
    await expect(
      connect(ADDRESS, { signal: controller.signal })
    ).rejects.toMatchObject({
      code: ErrorCode.CONNECT_CANCELLED,
    });
    expect(fake.calls.filter((c) => c.method === 'connect')).toEqual([]);
  });

  it('ignores an abort after the connect settled', async () => {
    androidWithDevice();
    const controller = new AbortController();
    const connection = await connect(ADDRESS, { signal: controller.signal });
    controller.abort();
    await flush();
    expect(connection.state).toBe('connected');
  });
});

describe('connection state and terminal events', () => {
  it('moves forward through disconnecting to disconnected on disconnect()', async () => {
    androidWithDevice();
    const connection = await connect(ADDRESS);
    const transitions: string[] = [];
    connection.onStateChange((e: ConnectionStateEvent) =>
      transitions.push(`${e.previousState}->${e.state}`)
    );
    const terminal = jest.fn();
    connection.onDisconnected(terminal);

    await connection.disconnect();

    expect(transitions).toEqual([
      'connected->disconnecting',
      'disconnecting->disconnected',
    ]);
    expect(connection.state).toBe('disconnected');
    expect(terminal).toHaveBeenCalledTimes(1);
    expect(terminal.mock.calls[0][0]).toEqual({
      reason: 'local',
      timestamp: expect.any(Number),
    });
  });

  it('reports a remote close once, skipping disconnecting', async () => {
    const fake = androidWithDevice();
    const connection = await connect(ADDRESS);
    const transitions: string[] = [];
    connection.onStateChange((e) =>
      transitions.push(`${e.previousState}->${e.state}`)
    );
    const terminal = jest.fn();
    connection.onDisconnected(terminal);

    fake.remoteClose(connection.id);
    fake.remoteClose(connection.id);

    expect(transitions).toEqual(['connected->disconnected']);
    expect(terminal).toHaveBeenCalledTimes(1);
    expect(terminal.mock.calls[0][0].reason).toBe('remote');
  });

  it('carries the error for failure-ended connections', async () => {
    const fake = androidWithDevice();
    const connection = await connect(ADDRESS);
    const events: DisconnectedEvent[] = [];
    connection.onDisconnected((e) => events.push(e));

    fake.failConnection(connection.id);

    expect(events).toHaveLength(1);
    expect(events[0]?.reason).toBe('error');
    expect(events[0]?.error).toMatchObject({
      code: ErrorCode.CONNECTION_LOST,
      connectionId: connection.id,
      nativeMessage: 'Broken pipe',
    });
  });

  it('ends every connection with BLUETOOTH_DISABLED when the adapter turns off', async () => {
    const fake = androidWithDevice();
    fake.addDevice({ address: '00:00:00:00:00:02' });
    const a = await connect(ADDRESS);
    const b = await connect('00:00:00:00:00:02');
    const codes: string[] = [];
    a.onDisconnected((e) => codes.push(e.error!.code));
    b.onDisconnected((e) => codes.push(e.error!.code));

    fake.setAdapterState('off');

    expect(codes).toEqual([
      ErrorCode.BLUETOOTH_DISABLED,
      ErrorCode.BLUETOOTH_DISABLED,
    ]);
  });

  it('replays the terminal event to late listeners', async () => {
    const fake = androidWithDevice();
    const connection = await connect(ADDRESS);
    fake.remoteClose(connection.id);
    const late = jest.fn();
    connection.onDisconnected(late);
    expect(late).toHaveBeenCalledTimes(1);
    expect(late.mock.calls[0][0].reason).toBe('remote');
  });

  it('never lets stale events affect a newer connection to the same device', async () => {
    const fake = androidWithDevice();
    const old = await connect(ADDRESS);
    fake.remoteClose(old.id);
    const fresh = await connect(ADDRESS);

    // A late notification about the old link arrives.
    fake.onConnectionStateChange.emit({
      connectionId: old.id,
      state: 'disconnected',
      previousState: 'connected',
      reason: 'remote',
      timestamp: Date.now(),
    });

    expect(fresh.id).not.toBe(old.id);
    expect(fresh.state).toBe('connected');
  });
});

describe('disconnect', () => {
  it('resolves without effect when already disconnected', async () => {
    const fake = androidWithDevice();
    const connection = await connect(ADDRESS);
    await connection.disconnect();
    await expect(connection.disconnect()).resolves.toBeUndefined();
    expect(fake.calls.filter((c) => c.method === 'disconnect')).toHaveLength(1);
  });

  it('shares one disconnect between concurrent calls', async () => {
    const fake = androidWithDevice();
    const connection = await connect(ADDRESS);
    await Promise.all([connection.disconnect(), connection.disconnect()]);
    expect(fake.calls.filter((c) => c.method === 'disconnect')).toHaveLength(1);
  });
});

describe('getConnections and getConnection', () => {
  it('lists open connections only', async () => {
    const fake = androidWithDevice();
    fake.addDevice({ address: '00:00:00:00:00:02' });
    const a = await connect(ADDRESS);
    const b = await connect('00:00:00:00:00:02');
    await b.disconnect();

    const open = await getConnections();
    expect(open).toEqual([a]);
    await expect(getConnection(a.id)).resolves.toBe(a);
    await expect(getConnection(b.id)).resolves.toBeNull();
    await expect(getConnection('missing')).resolves.toBeNull();
  });
});

describe('accept on Android', () => {
  it('resolves with the incoming connection', async () => {
    const fake = androidWithDevice();
    const pending = accept({
      serviceName: 'Kiosk',
      uuid: '00001101-0000-1000-8000-00805F9B34FB',
    });
    await flush();
    fake.incomingConnection('00:00:00:00:00:09');
    const connection = await pending;
    expect(connection.state).toBe('connected');
    expect(connection.device).toMatchObject({ id: '00:00:00:00:00:09' });
    expect(fake.calls.find((c) => c.method === 'accept')?.args[1]).toEqual({
      serviceName: 'Kiosk',
      uuid: '00001101-0000-1000-8000-00805F9B34FB',
    });
  });

  it('rejects a second accept with ACCEPT_ALREADY_RUNNING', async () => {
    androidWithDevice();
    const first = accept().catch((e: unknown) => e);
    await flush();
    await expect(accept()).rejects.toMatchObject({
      code: ErrorCode.ACCEPT_ALREADY_RUNNING,
    });
    await cancelAccept();
    expect(await first).toMatchObject({ code: ErrorCode.ACCEPT_CANCELLED });
  });

  it('cancelAccept rejects the pending accept and allows a new one', async () => {
    const fake = androidWithDevice();
    const first = accept().catch((e: unknown) => e);
    await flush();
    await expect(cancelAccept()).resolves.toBeUndefined();
    expect(await first).toMatchObject({ code: ErrorCode.ACCEPT_CANCELLED });

    const second = accept();
    await flush();
    fake.incomingConnection(ADDRESS);
    await expect(second).resolves.toBeInstanceOf(Connection);
  });

  it('resolves cancelAccept when nothing is pending', async () => {
    androidWithDevice();
    await expect(cancelAccept()).resolves.toBeUndefined();
  });

  it('rejects with ACCEPT_TIMEOUT', async () => {
    jest.useFakeTimers();
    try {
      androidWithDevice();
      const outcome = accept({ timeoutMs: 500 }).catch((e: unknown) => e);
      await jest.advanceTimersByTimeAsync(500);
      expect(await outcome).toMatchObject({ code: ErrorCode.ACCEPT_TIMEOUT });
    } finally {
      jest.useRealTimers();
    }
  });

  it('cancels through the abort signal', async () => {
    androidWithDevice();
    const controller = new AbortController();
    const pending = accept({ signal: controller.signal });
    await flush();
    controller.abort();
    await expect(pending).rejects.toMatchObject({
      code: ErrorCode.ACCEPT_CANCELLED,
    });
  });

  it.each([accept, cancelAccept])(
    '%p rejects with UNSUPPORTED_ON_PLATFORM on iOS',
    async (fn) => {
      iosWithAccessory();
      await expect((fn as () => Promise<unknown>)()).rejects.toMatchObject({
        code: ErrorCode.UNSUPPORTED_ON_PLATFORM,
      });
    }
  );
});
