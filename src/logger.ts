import type { LogLevel } from './types';

const ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

export const LOG_LEVELS = Object.keys(ORDER) as readonly LogLevel[];

const PREFIX = '[react-native-bluetooth-classic]';

let level: LogLevel = 'warn';

export function setJsLogLevel(next: LogLevel): void {
  level = next;
}

export function getJsLogLevel(): LogLevel {
  return level;
}

function enabled(target: Exclude<LogLevel, 'silent'>): boolean {
  return ORDER[target] >= ORDER[level];
}

export const log = {
  debug(...args: unknown[]): void {
    if (enabled('debug')) console.debug(PREFIX, ...args);
  },
  info(...args: unknown[]): void {
    if (enabled('info')) console.info(PREFIX, ...args);
  },
  warn(...args: unknown[]): void {
    if (enabled('warn')) console.warn(PREFIX, ...args);
  },
  error(...args: unknown[]): void {
    if (enabled('error')) console.error(PREFIX, ...args);
  },
};
