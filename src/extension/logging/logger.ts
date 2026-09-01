/**
 * Minimal logger abstraction so core modules stay free of the `vscode` module.
 * The extension wires an OutputChannel-backed implementation; tests use the console or noop.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(message: string, ...meta: unknown[]): void;
  info(message: string, ...meta: unknown[]): void;
  warn(message: string, ...meta: unknown[]): void;
  error(message: string, error?: unknown, ...meta: unknown[]): void;
}

export const noopLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export function formatError(error: unknown): string {
  if (error instanceof Error) {
    const extra =
      'details' in error && error.details !== undefined ? ` ${safeJson(error.details)}` : '';
    return `${error.name}: ${error.message}${extra}`;
  }
  return String(error);
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch (error) {
    return `[unserialisable: ${String(error)}]`;
  }
}
