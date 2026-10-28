import { BluetoothClassicError } from '../errors/BluetoothClassicError';
import { ErrorCode } from '../errors/ErrorCode';
import {
  createTextDecoder,
  decodeText,
  type StreamingTextDecoder,
  type TextEncoding,
} from '../data/codecs';
import type { Framer } from '../data/framers';
import type { DisconnectReason, ReadOptions } from '../types';
import type { AbortSignalLike } from '../validation';

export interface ReaderOptions<E extends TextEncoding | undefined = undefined> {
  framer: Framer;
  /** Decode frames to strings with this encoding. Without it frames are `Uint8Array`. */
  encoding?: E;
  /** A frame larger than this fails the reader with `BUFFER_OVERFLOW`. Defaults to 64 KiB. */
  maxFrameBytes?: number;
}

export type FrameOf<E extends TextEncoding | undefined> = E extends TextEncoding
  ? string
  : Uint8Array;

export interface TerminalState {
  reason: DisconnectReason;
  error?: BluetoothClassicError;
}

interface Waiter<T> {
  resolve: (value: IteratorResult<T>) => void;
  reject: (error: BluetoothClassicError) => void;
  forIteration: boolean;
  cleanup: () => void;
}

export const DEFAULT_MAX_FRAME_BYTES = 64 * 1024;

/**
 * Turns a connection's inbound bytes into frames. `read()` resolves with the
 * next frame; `for await` iterates frames until the connection ends.
 */
export class Reader<T extends string | Uint8Array> implements AsyncIterable<T> {
  private readonly queue: Array<{ value: T; bytes: number }> = [];
  private readonly waiters: Array<Waiter<T>> = [];
  private readonly decoder: StreamingTextDecoder | null;
  private failure: BluetoothClassicError | null = null;
  private terminal: TerminalState | null = null;
  private detach: (() => void) | null = null;

  /** @internal Created by `Connection.createReader()`. */
  constructor(
    private readonly framer: Framer,
    private readonly encoding: TextEncoding | undefined,
    private readonly maxFrameBytes: number,
    private readonly connectionId: string,
    private readonly adjustHeld: (delta: number) => void
  ) {
    // Streaming framers (raw) may split characters across frames, so decode
    // them with one persistent decoder; other frames decode independently.
    this.decoder =
      encoding !== undefined && framer.streaming === true
        ? createTextDecoder(encoding)
        : null;
  }

  /** @internal */
  attach(detach: () => void): void {
    this.detach = detach;
  }

  /** @internal Receives inbound chunks. */
  onChunk(chunk: Uint8Array): void {
    if (this.failure !== null || this.terminal !== null) {
      return;
    }
    let frames: Uint8Array[];
    try {
      frames = this.framer.push(chunk);
    } catch (error) {
      this.fail(
        new BluetoothClassicError(
          ErrorCode.INVALID_ARGUMENT,
          `The framer threw: ${String(error)}`,
          { connectionId: this.connectionId }
        )
      );
      return;
    }
    for (const frame of frames) {
      if (!this.deliver(frame)) return;
    }
    if ((this.framer.bufferedBytes ?? 0) > this.maxFrameBytes) {
      this.overflow();
    }
  }

  /** @internal Called once when the connection ends. */
  onEnd(state: TerminalState): void {
    if (this.terminal !== null) {
      return;
    }
    if (state.reason === 'remote' && this.failure === null) {
      for (const frame of this.framer.flush()) {
        if (!this.deliver(frame)) break;
      }
      if (this.decoder !== null) {
        const rest = this.decoder.end();
        if (rest.length > 0) this.enqueue(rest as T, 0);
      }
    }
    this.terminal = state;
    this.settleWaiters();
  }

  /**
   * Resolves with the next frame. Rejects with `READ_TIMEOUT` after
   * `timeoutMs` (the reader stays usable), with the connection's error after an
   * `'error'` disconnect, and with `NOT_CONNECTED` after any other disconnect.
   */
  read(options: ReadOptions = {}): Promise<T> {
    return this.next(false, options).then((result) => result.value as T);
  }

  /** Stops receiving frames and drops queued ones. */
  close(): void {
    this.detach?.();
    this.detach = null;
    this.dropQueue();
    if (this.terminal === null) {
      this.terminal = { reason: 'local' };
    }
    this.settleWaiters();
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => this.next(true, {}),
      return: async () => {
        this.close();
        return { done: true, value: undefined };
      },
    };
  }

  private next(
    forIteration: boolean,
    options: ReadOptions
  ): Promise<IteratorResult<T>> {
    const queued = this.queue.shift();
    if (queued !== undefined) {
      this.adjustHeld(-queued.bytes);
      return Promise.resolve({ done: false, value: queued.value });
    }
    const settled = this.settledResult(forIteration);
    if (settled !== null) {
      return settled;
    }
    return new Promise<IteratorResult<T>>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const signal = options.signal as AbortSignalLike | undefined;
      const waiter: Waiter<T> = {
        resolve,
        reject,
        forIteration,
        cleanup: () => {
          if (timer !== undefined) clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          const index = this.waiters.indexOf(waiter);
          if (index >= 0) this.waiters.splice(index, 1);
        },
      };
      const onAbort = () => {
        waiter.cleanup();
        reject(
          new BluetoothClassicError(
            ErrorCode.READ_TIMEOUT,
            'The read was aborted',
            {
              connectionId: this.connectionId,
            }
          )
        );
      };
      if (options.timeoutMs !== undefined) {
        timer = setTimeout(() => {
          waiter.cleanup();
          reject(
            new BluetoothClassicError(
              ErrorCode.READ_TIMEOUT,
              `No frame arrived within ${options.timeoutMs} ms`,
              { connectionId: this.connectionId }
            )
          );
        }, options.timeoutMs);
      }
      if (signal !== undefined) {
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener('abort', onAbort);
      }
      this.waiters.push(waiter);
    });
  }

  /** The outcome for a read when nothing is queued, or `null` to wait. */
  private settledResult(
    forIteration: boolean
  ): Promise<IteratorResult<T>> | null {
    if (this.failure !== null) {
      return Promise.reject(this.failure);
    }
    if (this.terminal === null) {
      return null;
    }
    if (this.terminal.reason === 'error' && this.terminal.error !== undefined) {
      return Promise.reject(this.terminal.error);
    }
    if (forIteration) {
      return Promise.resolve({ done: true, value: undefined });
    }
    return Promise.reject(
      new BluetoothClassicError(
        ErrorCode.NOT_CONNECTED,
        'The connection has ended',
        {
          connectionId: this.connectionId,
        }
      )
    );
  }

  private settleWaiters(): void {
    while (this.queue.length > 0 && this.waiters.length > 0) {
      const waiter = this.waiters[0]!;
      const queued = this.queue.shift()!;
      this.adjustHeld(-queued.bytes);
      waiter.cleanup();
      waiter.resolve({ done: false, value: queued.value });
    }
    if (this.queue.length > 0) {
      return;
    }
    for (const waiter of [...this.waiters]) {
      const outcome = this.settledResult(waiter.forIteration);
      if (outcome === null) continue;
      waiter.cleanup();
      outcome.then(waiter.resolve, waiter.reject);
    }
  }

  /** Returns `false` when the reader failed and delivery must stop. */
  private deliver(frame: Uint8Array): boolean {
    if (frame.length > this.maxFrameBytes) {
      this.overflow();
      return false;
    }
    let value: T;
    if (this.encoding === undefined) {
      value = frame as T;
    } else if (this.decoder !== null) {
      const text = this.decoder.decode(frame);
      if (text.length === 0) return true;
      value = text as T;
    } else {
      value = decodeText(frame, this.encoding) as T;
    }
    this.enqueue(value, frame.length);
    return true;
  }

  private enqueue(value: T, bytes: number): void {
    const waiter = this.waiters[0];
    if (waiter !== undefined) {
      waiter.cleanup();
      waiter.resolve({ done: false, value });
      return;
    }
    this.queue.push({ value, bytes });
    this.adjustHeld(bytes);
  }

  private overflow(): void {
    this.fail(
      new BluetoothClassicError(
        ErrorCode.BUFFER_OVERFLOW,
        `A frame exceeded maxFrameBytes (${this.maxFrameBytes})`,
        { connectionId: this.connectionId }
      )
    );
  }

  private fail(error: BluetoothClassicError): void {
    if (this.failure !== null) return;
    this.failure = error;
    this.framer.reset();
    this.detach?.();
    this.detach = null;
    this.dropQueue();
    this.settleWaiters();
  }

  private dropQueue(): void {
    const held = this.queue.reduce((sum, entry) => sum + entry.bytes, 0);
    this.queue.length = 0;
    if (held > 0) this.adjustHeld(-held);
  }
}
