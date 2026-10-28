import { EventHub, onEventHubsReset } from '../events';
import { log } from '../logger';
import type {
  NativeConnection,
  NativeConnectionStateEvent,
  NativeDataEvent,
} from '../specs/NativeBluetoothClassic';
import type { Subscription } from '../types';
import { Connection } from './Connection';

type StashedEvent =
  | { kind: 'data'; event: NativeDataEvent }
  | { kind: 'state'; event: NativeConnectionStateEvent };

const dataHub = new EventHub('onData', { map: (event) => event });
const stateHub = new EventHub('onConnectionStateChange', {
  map: (event) => event,
});

/** Open connections by id. Ended connections are removed. */
const connections = new Map<string, Connection>();
/**
 * Events for connections whose `connect()`/`accept()` has not resolved in JS
 * yet. Only kept while such an operation is pending.
 */
const stash = new Map<string, StashedEvent[]>();
let pendingOperations = 0;
let subscriptions: Subscription[] = [];

const MAX_STASHED_EVENTS = 4096;

function route(id: string, entry: StashedEvent): void {
  const connection = connections.get(id);
  if (connection !== undefined) {
    if (entry.kind === 'data') connection.handleData(entry.event);
    else connection.handleState(entry.event);
    return;
  }
  if (pendingOperations > 0) {
    const events = stash.get(id) ?? [];
    if (events.length < MAX_STASHED_EVENTS) {
      events.push(entry);
      stash.set(id, events);
    }
    return;
  }
  log.debug(`Dropping ${entry.kind} event for unknown connection ${id}`);
}

function ensureSubscribed(): void {
  if (subscriptions.length > 0) {
    return;
  }
  subscriptions = [
    dataHub.add((event) => route(event.connectionId, { kind: 'data', event })),
    stateHub.add((event) =>
      route(event.connectionId, { kind: 'state', event })
    ),
  ];
}

/** Marks a connect/accept as in flight so early events are kept. */
export function beginOperation(): void {
  ensureSubscribed();
  pendingOperations++;
}

export function endOperation(): void {
  pendingOperations = Math.max(0, pendingOperations - 1);
  if (pendingOperations === 0) {
    stash.clear();
  }
}

/** Wraps a native connection, replaying any events that arrived first. */
export function adopt(
  native: NativeConnection,
  maxBufferBytes: number
): Connection {
  ensureSubscribed();
  const existing = connections.get(native.id);
  if (existing !== undefined) {
    return existing;
  }
  const connection = new Connection(native, maxBufferBytes, (ended) => {
    if (connections.get(ended.id) === ended) {
      connections.delete(ended.id);
    }
  });
  connections.set(connection.id, connection);
  const early = stash.get(native.id) ?? [];
  stash.delete(native.id);
  for (const entry of early) {
    route(native.id, entry);
  }
  return connection;
}

export function lookup(id: string): Connection | undefined {
  return connections.get(id);
}

onEventHubsReset(() => {
  connections.clear();
  stash.clear();
  pendingOperations = 0;
  subscriptions = [];
});
