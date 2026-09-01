import * as vscode from 'vscode';
import { formatError, type Logger } from './logger';

/**
 * Logger backed by a VS Code LogOutputChannel ("Visual Git History"). The log level is managed
 * by VS Code (Developer: Set Log Level…), so no extra setting is needed.
 */
export class OutputChannelLogger implements Logger, vscode.Disposable {
  readonly channel: vscode.LogOutputChannel;

  constructor(name = 'Visual Git History') {
    this.channel = vscode.window.createOutputChannel(name, { log: true });
  }

  debug(message: string, ...meta: unknown[]): void {
    this.channel.debug(message, ...meta.map(stringify));
  }

  info(message: string, ...meta: unknown[]): void {
    this.channel.info(message, ...meta.map(stringify));
  }

  warn(message: string, ...meta: unknown[]): void {
    this.channel.warn(message, ...meta.map(stringify));
  }

  error(message: string, error?: unknown, ...meta: unknown[]): void {
    const suffix = error === undefined ? '' : ` — ${formatError(error)}`;
    this.channel.error(`${message}${suffix}`, ...meta.map(stringify));
  }

  show(): void {
    this.channel.show(true);
  }

  dispose(): void {
    this.channel.dispose();
  }
}

function stringify(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
