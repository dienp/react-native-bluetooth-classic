import {
  adopt,
  beginOperation,
  endOperation,
  lookup,
} from '../connection/registry';
import type { Connection } from '../connection/Connection';
import {
  BluetoothClassicError,
  isBluetoothClassicError,
} from '../errors/BluetoothClassicError';
import { ErrorCode } from '../errors/ErrorCode';
import { guard, requirePlatform } from '../internal';
import { getNativeModule } from '../native';
import { hostPlatform } from '../platform';
import type {
  NativeAcceptOptions,
  NativeConnectOptions,
  NativeConnection,
} from '../specs/NativeBluetoothClassic';
import type { AcceptOptions, ConnectOptions } from '../types';
import {
  normalizeAddress,
  requireNonEmptyString,
  UUID_PATTERN,
  validateOptions,
  type AbortSignalLike,
  type Schema,
} from '../validation';

export const DEFAULT_CONNECT_TIMEOUT_MS = 15_000;
export const DEFAULT_MAX_BUFFER_BYTES = 1024 * 1024;

const MAX_BUFFER_RULE = {
  kind: 'integer',
  min: 1024,
  max: 256 * 1024 * 1024,
} as const;

const UUID_RULE = {
  kind: 'string',
  pattern: UUID_PATTERN,
  hint: 'a UUID such as "00001101-0000-1000-8000-00805F9B34FB"',
} as const;

const TRANSPORT_RULE = {
  kind: 'enum',
  values: ['secure', 'insecure'],
} as const;

const CONNECT_SCHEMA: Schema = {
  timeoutMs: { kind: 'integer', min: 1, max: 600_000 },
  signal: { kind: 'signal' },
  maxBufferBytes: MAX_BUFFER_RULE,
  android: {
    kind: 'object',
    schema: {
      transport: TRANSPORT_RULE,
      uuid: UUID_RULE,
      fallbackChannel: { kind: 'integer', min: 1, max: 30 },
    },
  },
  ios: {
    kind: 'object',
    schema: {
      protocol: { kind: 'string' },
    },
  },
};

const ACCEPT_SCHEMA: Schema = {
  uuid: UUID_RULE,
  serviceName: { kind: 'string' },
  transport: TRANSPORT_RULE,
  timeoutMs: { kind: 'integer', min: 1, max: 24 * 60 * 60 * 1000 },
  signal: { kind: 'signal' },
  maxBufferBytes: MAX_BUFFER_RULE,
};

let operationCounter = 0;

function nextOperationId(): string {
  operationCounter += 1;
  return `op-${Date.now().toString(36)}-${operationCounter}`;
}

/**
 * Runs a cancellable native connect/accept. An abort before the operation
 * settles always ends in `cancelCode`, closing any connection that raced it.
 */
async function runOperation(
  signal: AbortSignalLike | undefined,
  cancelCode:
    typeof ErrorCode.CONNECT_CANCELLED | typeof ErrorCode.ACCEPT_CANCELLED,
  maxBufferBytes: number,
  start: (operationId: string) => Promise<NativeConnection>
): Promise<Connection> {
  const cancelled = () =>
    new BluetoothClassicError(
      cancelCode,
      cancelCode === ErrorCode.CONNECT_CANCELLED
        ? 'The connection attempt was cancelled'
        : 'The accept was cancelled'
    );
  if (signal?.aborted) {
    throw cancelled();
  }
  const native = getNativeModule();
  const operationId = nextOperationId();
  let aborted = false;
  const onAbort = () => {
    aborted = true;
    native.cancelOperation(operationId).catch(() => {});
  };
  signal?.addEventListener('abort', onAbort);
  beginOperation();
  try {
    let connection: Connection;
    try {
      connection = adopt(await start(operationId), maxBufferBytes);
    } catch (error) {
      if (aborted && !isBluetoothClassicError(error, cancelCode)) {
        throw cancelled();
      }
      throw error;
    }
    if (aborted) {
      await connection.disconnect({ timeoutMs: 0 }).catch(() => {});
      throw cancelled();
    }
    return connection;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    endOperation();
  }
}

/**
 * Opens a connection. On Android `deviceId` is the device address; on iOS it
 * is the accessory `id`. Options for one platform go under `android` or `ios`
 * and are ignored on the other.
 */
export function connect(
  deviceId: string,
  options?: ConnectOptions
): Promise<Connection> {
  return guard(
    async () => {
      const platform = hostPlatform();
      if (platform === 'other') {
        getNativeModule(); // Throws UNSUPPORTED_ON_PLATFORM.
      }
      const validated = validateOptions<ConnectOptions>(
        options,
        CONNECT_SCHEMA
      );
      const target =
        platform === 'android'
          ? normalizeAddress(deviceId, 'deviceId')
          : requireNonEmptyString(deviceId, 'deviceId');
      const nativeOptions: NativeConnectOptions = {
        timeoutMs: validated.timeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
      };
      if (platform === 'android') {
        const android = validated.android ?? {};
        if (android.transport !== undefined)
          nativeOptions.transport = android.transport;
        if (android.uuid !== undefined) nativeOptions.uuid = android.uuid;
        if (android.fallbackChannel !== undefined) {
          nativeOptions.fallbackChannel = android.fallbackChannel;
        }
      } else if (validated.ios?.protocol !== undefined) {
        nativeOptions.protocol = validated.ios.protocol;
      }
      return runOperation(
        validated.signal,
        ErrorCode.CONNECT_CANCELLED,
        validated.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES,
        (operationId) =>
          getNativeModule().connect(operationId, target, nativeOptions)
      );
    },
    typeof deviceId === 'string'
      ? {
          deviceId:
            hostPlatform() === 'android' ? deviceId.toUpperCase() : deviceId,
        }
      : {}
  );
}

/**
 * Android only. Listens for one incoming RFCOMM connection and resolves with
 * it. The listening socket is closed once the call settles.
 */
export function accept(options?: AcceptOptions): Promise<Connection> {
  return guard(async () => {
    requirePlatform('android', 'accept()');
    const validated = validateOptions<AcceptOptions>(options, ACCEPT_SCHEMA);
    const nativeOptions: NativeAcceptOptions = {};
    if (validated.timeoutMs !== undefined)
      nativeOptions.timeoutMs = validated.timeoutMs;
    if (validated.transport !== undefined)
      nativeOptions.transport = validated.transport;
    if (validated.uuid !== undefined) nativeOptions.uuid = validated.uuid;
    if (validated.serviceName !== undefined) {
      nativeOptions.serviceName = validated.serviceName;
    }
    return runOperation(
      validated.signal,
      ErrorCode.ACCEPT_CANCELLED,
      validated.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES,
      (operationId) => getNativeModule().accept(operationId, nativeOptions)
    );
  });
}

/** Android only. Cancels a pending `accept()`; resolves even if none is pending. */
export function cancelAccept(): Promise<void> {
  return guard(async () => {
    requirePlatform('android', 'cancelAccept()');
    await getNativeModule().cancelAccept();
  });
}

/** Resolves with every connection that has not ended. */
export function getConnections(): Promise<Connection[]> {
  return guard(async () => {
    const natives = await getNativeModule().getConnections();
    return natives
      .map(
        (native) => lookup(native.id) ?? adopt(native, DEFAULT_MAX_BUFFER_BYTES)
      )
      .filter((connection) => connection.state !== 'disconnected');
  });
}

/** Resolves with the open connection with this id, or `null`. */
export function getConnection(id: string): Promise<Connection | null> {
  return guard(async () => {
    requireNonEmptyString(id, 'id');
    const connections = await getConnections();
    return connections.find((connection) => connection.id === id) ?? null;
  });
}
