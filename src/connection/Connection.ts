import { toAndroidDevice, toIosAccessory } from '../devices';
import { BluetoothClassicError } from '../errors/BluetoothClassicError';
import { ErrorCode } from '../errors/ErrorCode';
import { isErrorCode } from '../errors/BluetoothClassicError';
import { fromBase64, toBase64 } from '../data/base64';
import {
  encodeText,
  ENCODINGS,
  TEXT_ENCODINGS,
  type Encoding,
  type TextEncoding,
} from '../data/codecs';
import { isFramer } from '../data/framers';
import { guard } from '../internal';
import { log } from '../logger';
import { getNativeModule } from '../native';
import type {
  NativeConnection,
  NativeConnectionStateEvent,
  NativeDataEvent,
} from '../specs/NativeBluetoothClassic';
import type {
  ConnectionState,
  ConnectionStateEvent,
  Device,
  DisconnectOptions,
  DisconnectReason,
  Subscription,
} from '../types';
import {
  invalidArgument,
  requireFunction,
  validateOptions,
  type Schema,
} from '../validation';
import { InboundStream } from './stream';
import {
  DEFAULT_MAX_FRAME_BYTES,
  Reader,
  type FrameOf,
  type ReaderOptions,
  type TerminalState,
} from './reader';

export interface DisconnectedEvent {
  readonly reason: DisconnectReason;
  /** Present when `reason` is `'error'`. */
  readonly error?: BluetoothClassicError;
  readonly timestamp: number;
}

export interface WriteOptions {
  /** How a string is converted to bytes. Defaults to `'utf8'`. */
  encoding?: Encoding;
  /** End the connection with `WRITE_TIMEOUT` if the write is not accepted in time. */
  timeoutMs?: number;
}

const STATE_RANK: Record<ConnectionState, number> = {
  connecting: 0,
  connected: 1,
  disconnecting: 2,
  disconnected: 3,
};

const WRITE_SCHEMA: Schema = {
  encoding: { kind: 'enum', values: ENCODINGS },
  timeoutMs: { kind: 'integer', min: 1, max: 600_000 },
};

const DISCONNECT_SCHEMA: Schema = {
  timeoutMs: { kind: 'integer', min: 0, max: 600_000 },
};

const READER_SCHEMA: Schema = {
  encoding: { kind: 'enum', values: TEXT_ENCODINGS },
  maxFrameBytes: { kind: 'integer', min: 1, max: 256 * 1024 * 1024 },
};

const DEFAULT_DISCONNECT_TIMEOUT_MS = 5000;

const REASONS: readonly DisconnectReason[] = ['local', 'remote', 'error'];

function toState(value: string): ConnectionState | null {
  return value in STATE_RANK ? (value as ConnectionState) : null;
}

/**
 * An open connection to an Android device or an iOS accessory. All
 * operations target this connection only.
 */
export class Connection {
  /** Opaque identifier, unique for the lifetime of the module. */
  readonly id: string;
  readonly device: Device;
  /** iOS: the accessory protocol of this session. */
  readonly protocol?: string;
  /** When the connection was established (epoch milliseconds). */
  readonly connectedAt: number;

  private currentState: ConnectionState;
  private terminal: DisconnectedEvent | null = null;
  private readonly stream: InboundStream;
  private readonly stateListeners = new Set<
    (event: ConnectionStateEvent) => void
  >();
  private readonly disconnectListeners = new Set<
    (event: DisconnectedEvent) => void
  >();
  private readonly readers = new Set<Reader<string | Uint8Array>>();
  private expectedSeq = 0;
  private disconnecting: Promise<void> | null = null;

  /** @internal Created by `connect()` and `accept()`. */
  constructor(
    native: NativeConnection,
    maxBufferBytes: number,
    private readonly onTerminal: (connection: Connection) => void
  ) {
    this.id = native.id;
    if (native.androidDevice !== undefined) {
      this.device = toAndroidDevice(native.androidDevice);
    } else if (native.accessory !== undefined) {
      this.device = toIosAccessory(native.accessory);
    } else {
      throw new BluetoothClassicError(
        ErrorCode.UNKNOWN,
        'The native connection has no device',
        { connectionId: native.id }
      );
    }
    if (native.protocol !== undefined) {
      this.protocol = native.protocol;
    }
    this.connectedAt = native.connectedAt;
    this.currentState = toState(native.state) ?? 'connected';
    this.stream = new InboundStream(maxBufferBytes, () => this.overflow());
  }

  get state(): ConnectionState {
    return this.currentState;
  }

  /**
   * Writes bytes, or a string converted with `options.encoding`. Resolves once
   * the OS has accepted every byte. Writes are sent in call order.
   */
  write(data: Uint8Array | string, options?: WriteOptions): Promise<void> {
    return guard(
      async () => {
        const { encoding, timeoutMs } = validateOptions<WriteOptions>(
          options,
          WRITE_SCHEMA
        );
        let bytes: Uint8Array;
        if (data instanceof Uint8Array) {
          if (encoding !== undefined) {
            throw invalidArgument(
              'options.encoding only applies to string data'
            );
          }
          bytes = data;
        } else if (typeof data === 'string') {
          bytes = encodeText(data, encoding ?? 'utf8');
        } else {
          throw invalidArgument('data must be a Uint8Array or a string');
        }
        if (this.currentState !== 'connected') {
          throw this.notConnected();
        }
        if (bytes.length === 0) {
          return;
        }
        await getNativeModule().write(this.id, toBase64(bytes), timeoutMs ?? 0);
      },
      { connectionId: this.id }
    );
  }

  /**
   * Lets queued writes finish (up to `timeoutMs`), closes the link and
   * resolves once the connection is `disconnected`. Calling it again has no
   * effect.
   */
  disconnect(options?: DisconnectOptions): Promise<void> {
    return guard(
      async () => {
        const { timeoutMs } = validateOptions<DisconnectOptions>(
          options,
          DISCONNECT_SCHEMA
        );
        if (this.terminal !== null) {
          return;
        }
        if (this.disconnecting === null) {
          this.disconnecting = getNativeModule()
            .disconnect(this.id, timeoutMs ?? DEFAULT_DISCONNECT_TIMEOUT_MS)
            .then(
              () => this.end('local'),
              (error: unknown) => {
                this.disconnecting = null;
                throw error;
              }
            );
        }
        await this.disconnecting;
      },
      { connectionId: this.id }
    );
  }

  /** Receives every inbound chunk from now on (the first consumer also gets the backlog). */
  onData(listener: (chunk: Uint8Array) => void): Subscription {
    requireFunction(listener, 'listener');
    const remove = this.stream.addConsumer((chunk) => {
      try {
        listener(chunk);
      } catch (error) {
        log.error('A data listener threw:', error);
      }
    });
    return once(remove);
  }

  onStateChange(listener: (event: ConnectionStateEvent) => void): Subscription {
    requireFunction(listener, 'listener');
    this.stateListeners.add(listener);
    return once(() => this.stateListeners.delete(listener));
  }

  /**
   * Called exactly once when the connection ends. A listener added after
   * that is called immediately with the same event.
   */
  onDisconnected(listener: (event: DisconnectedEvent) => void): Subscription {
    requireFunction(listener, 'listener');
    if (this.terminal !== null) {
      safeCall(listener, this.terminal);
      return once(() => {});
    }
    this.disconnectListeners.add(listener);
    return once(() => this.disconnectListeners.delete(listener));
  }

  /** Creates a reader that splits the inbound stream into frames. */
  createReader<E extends TextEncoding | undefined = undefined>(
    options: ReaderOptions<E>
  ): Reader<FrameOf<E>> {
    if (
      typeof options !== 'object' ||
      options === null ||
      !isFramer(options.framer)
    ) {
      throw invalidArgument('options.framer must be a Framer');
    }
    const { framer, ...rest } = options;
    const { encoding, maxFrameBytes } = validateOptions<{
      encoding?: TextEncoding;
      maxFrameBytes?: number;
    }>(rest, READER_SCHEMA);
    const reader = new Reader<FrameOf<E>>(
      framer,
      encoding,
      maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES,
      this.id,
      (delta) => this.stream.adjustHeld(delta)
    );
    const generic = reader as unknown as Reader<string | Uint8Array>;
    if (this.terminal !== null) {
      generic.onEnd(this.terminalState());
      return reader;
    }
    this.readers.add(generic);
    const remove = this.stream.addConsumer((chunk) => reader.onChunk(chunk));
    reader.attach(() => {
      remove();
      this.readers.delete(generic);
    });
    return reader;
  }

  /** @internal Routes a native data event. */
  handleData(event: NativeDataEvent): void {
    if (this.terminal !== null) {
      return;
    }
    if (event.seq !== this.expectedSeq) {
      log.error(
        `Data sequence gap on connection ${this.id}: expected ${this.expectedSeq}, got ${event.seq}`
      );
    }
    this.expectedSeq = event.seq + 1;
    this.stream.push(fromBase64(event.data));
  }

  /** @internal Routes a native state event. */
  handleState(event: NativeConnectionStateEvent): void {
    const state = toState(event.state);
    if (state === null || this.terminal !== null) {
      return;
    }
    if (state === 'disconnected') {
      const reason = (REASONS as readonly string[]).includes(event.reason ?? '')
        ? (event.reason as DisconnectReason)
        : 'error';
      let error: BluetoothClassicError | undefined;
      if (reason === 'error') {
        const details: ConstructorParameters<typeof BluetoothClassicError>[2] =
          {
            connectionId: this.id,
          };
        if (event.nativeCode !== undefined)
          details.nativeCode = event.nativeCode;
        if (event.nativeMessage !== undefined) {
          details.nativeMessage = event.nativeMessage;
        }
        error = new BluetoothClassicError(
          isErrorCode(event.errorCode)
            ? event.errorCode
            : ErrorCode.CONNECTION_LOST,
          event.errorMessage ?? 'The connection ended because of a failure',
          details
        );
      }
      this.end(reason, error, event.timestamp);
      return;
    }
    this.transition(state, event.timestamp);
  }

  /** @internal Ends the connection locally (used when the native side cannot report it). */
  end(
    reason: DisconnectReason,
    error?: BluetoothClassicError,
    timestamp = Date.now()
  ): void {
    if (this.terminal !== null) {
      return;
    }
    this.transition('disconnected', timestamp);
    const event: DisconnectedEvent = Object.freeze(
      error !== undefined ? { reason, error, timestamp } : { reason, timestamp }
    );
    this.terminal = event;
    for (const reader of Array.from(this.readers)) {
      reader.onEnd(this.terminalState());
    }
    this.readers.clear();
    const listeners = Array.from(this.disconnectListeners);
    this.disconnectListeners.clear();
    for (const listener of listeners) {
      safeCall(listener, event);
    }
    this.onTerminal(this);
  }

  private transition(state: ConnectionState, timestamp: number): void {
    const previousState = this.currentState;
    if (STATE_RANK[state] <= STATE_RANK[previousState]) {
      return;
    }
    this.currentState = state;
    const event: ConnectionStateEvent = Object.freeze({
      state,
      previousState,
      timestamp,
    });
    for (const listener of Array.from(this.stateListeners)) {
      safeCall(listener, event);
    }
  }

  private terminalState(): TerminalState {
    const terminal = this.terminal!;
    return terminal.error !== undefined
      ? { reason: terminal.reason, error: terminal.error }
      : { reason: terminal.reason };
  }

  private notConnected(): BluetoothClassicError {
    return new BluetoothClassicError(
      ErrorCode.NOT_CONNECTED,
      this.currentState === 'disconnecting'
        ? 'The connection is disconnecting'
        : 'The connection has ended',
      { connectionId: this.id }
    );
  }

  private overflow(): void {
    const message = 'Received data exceeded maxBufferBytes';
    const error = new BluetoothClassicError(
      ErrorCode.BUFFER_OVERFLOW,
      message,
      {
        connectionId: this.id,
      }
    );
    const native = (() => {
      try {
        return getNativeModule();
      } catch {
        return null;
      }
    })();
    native
      ?.closeWithError(this.id, ErrorCode.BUFFER_OVERFLOW, message)
      .catch((cause: unknown) => log.warn('closeWithError failed:', cause));
    this.end('error', error);
  }
}

function once(remove: () => void): Subscription {
  let removed = false;
  return {
    remove: () => {
      if (removed) return;
      removed = true;
      remove();
    },
  };
}

function safeCall<T>(listener: (event: T) => void, event: T): void {
  try {
    listener(event);
  } catch (error) {
    log.error('A connection listener threw:', error);
  }
}
