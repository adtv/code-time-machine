import { Worker } from 'node:worker_threads';
import type { HighlightedLines, ThemeKind } from '../../shared/messages/protocol';
import { LruCache } from '../../shared/util/lru';
import { noopLogger, type Logger } from '../logging/logger';
import type { HighlightProvider } from '../session/historySession';
import type { HighlightRequest, HighlightResponse } from './highlightProtocol';

interface Pending {
  resolve: (value: HighlightedLines | undefined) => void;
  signal: AbortSignal | undefined;
  onAbort: () => void;
}

/**
 * HighlightProvider backed by a worker thread. Failures degrade to "no highlighting" (plain
 * text) and are logged once; the worker is restarted lazily if it dies.
 */
export class WorkerHighlightService implements HighlightProvider {
  private worker: Worker | undefined;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private disabled = false;
  private disposed = false;
  private readonly cache = new LruCache<HighlightedLines>({
    maxEntries: 48,
    maxBytes: 16 * 1024 * 1024,
    sizeOf: (value) => value.lines.reduce((n, spans) => n + spans.length * 24 + 16, 64),
  });

  constructor(
    private readonly workerPath: string,
    private readonly logger: Logger = noopLogger,
  ) {}

  get stats(): { hits: number; misses: number } {
    return this.cache.stats;
  }

  async highlight(
    lines: readonly string[],
    languageId: string,
    theme: ThemeKind,
    signal?: AbortSignal,
    fileName?: string,
  ): Promise<HighlightedLines | undefined> {
    if (this.disabled || this.disposed || signal?.aborted) {
      return undefined;
    }
    const key = `${theme}|${languageId}|${fileName ?? ''}|${hashLines(lines)}`;
    const cached = this.cache.get(key);
    if (cached) {
      return cached;
    }
    const started = Date.now();
    const result = await this.request(lines, languageId, theme, signal, fileName);
    if (result) {
      this.cache.set(key, result);
      this.logger.debug(
        `highlighted ${lines.length} lines (${languageId}, ${theme}) in ${Date.now() - started}ms`,
      );
    }
    return result;
  }

  dispose(): void {
    this.disposed = true;
    this.rejectAll();
    void this.worker?.terminate();
    this.worker = undefined;
  }

  private request(
    lines: readonly string[],
    languageId: string,
    theme: ThemeKind,
    signal: AbortSignal | undefined,
    fileName: string | undefined,
  ): Promise<HighlightedLines | undefined> {
    return new Promise<HighlightedLines | undefined>((resolve) => {
      let worker: Worker;
      try {
        worker = this.ensureWorker();
      } catch (error) {
        this.disable('failed to start the highlight worker', error);
        resolve(undefined);
        return;
      }
      const id = this.nextId++;
      const onAbort = (): void => {
        this.pending.delete(id);
        resolve(undefined);
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.pending.set(id, { resolve, signal, onAbort });
      const message: HighlightRequest = {
        id,
        lines: [...lines],
        languageId,
        theme,
        ...(fileName !== undefined ? { fileName } : {}),
      };
      worker.postMessage(message);
    });
  }

  private ensureWorker(): Worker {
    if (this.worker) {
      return this.worker;
    }
    const worker = new Worker(this.workerPath);
    worker.on('message', (response: HighlightResponse) => {
      const pending = this.pending.get(response.id);
      if (!pending) {
        return;
      }
      this.pending.delete(response.id);
      pending.signal?.removeEventListener('abort', pending.onAbort);
      if ('error' in response) {
        this.logger.warn(`highlighting failed: ${response.error}`);
        pending.resolve(undefined);
      } else {
        pending.resolve(response.result);
      }
    });
    worker.on('error', (error) => {
      this.logger.error('highlight worker error', error);
      this.rejectAll();
    });
    worker.on('exit', (code) => {
      if (!this.disposed) {
        this.logger.warn(`highlight worker exited with code ${code}`);
      }
      this.rejectAll();
      if (this.worker === worker) {
        this.worker = undefined;
      }
    });
    this.worker = worker;
    return worker;
  }

  private rejectAll(): void {
    for (const pending of this.pending.values()) {
      pending.signal?.removeEventListener('abort', pending.onAbort);
      pending.resolve(undefined);
    }
    this.pending.clear();
  }

  private disable(message: string, error: unknown): void {
    if (!this.disabled) {
      this.disabled = true;
      this.logger.error(`${message}; syntax highlighting disabled`, error);
    }
  }
}

/** FNV-1a over the joined text — fast and good enough as a cache key component. */
export function hashLines(lines: readonly string[]): string {
  let hash = 0x811c9dc5;
  for (const line of lines) {
    for (let i = 0; i < line.length; i++) {
      hash ^= line.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    hash ^= 10;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${lines.length}:${hash.toString(16)}`;
}
