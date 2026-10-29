import type { CodegenTypes, EventSubscription } from 'react-native';

import { log } from './logger';
import { getNativeModule } from './native';
import type { Spec } from './specs/NativeBluetoothClassic';
import type { Subscription } from './types';
import { requireFunction } from './validation';

export type NativeEventName =
  | 'onAdapterStateChange'
  | 'onDeviceFound'
  | 'onBondStateChange'
  | 'onBondLost'
  | 'onAccessoryConnected'
  | 'onAccessoryDisconnected'
  | 'onConnectionStateChange'
  | 'onData';

export type NativePayload<N extends NativeEventName> =
  Spec[N] extends CodegenTypes.EventEmitter<infer E> ? E : never;

interface HubOptions<N extends NativeEventName, P> {
  /** Converts the native payload into the public payload. */
  map: (event: NativePayload<N>) => P;
  /** Drops events (once for all listeners) when it returns `false`. */
  filter?: (event: NativePayload<N>) => boolean;
}

interface Entry<P> {
  listener: (event: P) => void;
}

const hubs = new Set<{ reset(): void }>();

/**
 * @internal Drops every listener and native subscription. Used by the Jest
 * mock between tests.
 */
export function __resetEventHubs(): void {
  hubs.forEach((hub) => hub.reset());
}

/**
 * Fans one native event out to any number of JS listeners. Each listener is
 * isolated: one that throws is reported and does not affect the others.
 */
export class EventHub<N extends NativeEventName, P> {
  private readonly entries = new Set<Entry<P>>();
  private nativeSubscription: EventSubscription | null = null;
  private nativeModule: Spec | null = null;

  constructor(
    private readonly name: N,
    private readonly options: HubOptions<N, P>
  ) {
    hubs.add(this);
  }

  /** Adds a listener. Throws if the native module is missing. */
  add(listener: (event: P) => void): Subscription {
    requireFunction(listener, 'listener');
    this.ensureNativeSubscription();
    const entry: Entry<P> = { listener };
    this.entries.add(entry);
    let removed = false;
    return {
      remove: () => {
        if (removed) {
          return;
        }
        removed = true;
        this.entries.delete(entry);
        if (this.entries.size === 0) {
          this.releaseNativeSubscription();
        }
      },
    };
  }

  get listenerCount(): number {
    return this.entries.size;
  }

  reset(): void {
    this.entries.clear();
    this.releaseNativeSubscription();
  }

  private ensureNativeSubscription(): void {
    const module = getNativeModule();
    if (this.nativeSubscription !== null && this.nativeModule === module) {
      return;
    }
    // The native module was replaced (for example by the Jest mock): move over.
    this.releaseNativeSubscription();
    const subscribe = module[this.name] as unknown as (
      handler: (event: NativePayload<N>) => void
    ) => EventSubscription;
    this.nativeModule = module;
    this.nativeSubscription = subscribe((event) => this.dispatch(event));
  }

  private releaseNativeSubscription(): void {
    this.nativeSubscription?.remove();
    this.nativeSubscription = null;
    this.nativeModule = null;
  }

  private dispatch(event: NativePayload<N>): void {
    if (this.options.filter !== undefined && !this.options.filter(event)) {
      return;
    }
    const payload = this.options.map(event);
    for (const entry of Array.from(this.entries)) {
      if (!this.entries.has(entry)) {
        continue;
      }
      try {
        entry.listener(payload);
      } catch (error) {
        log.error(`A listener for ${this.name} threw:`, error);
      }
    }
  }
}
