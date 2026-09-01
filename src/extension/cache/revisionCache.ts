import type { RevisionContent } from '../../shared/models/revision';
import { LruCache } from '../../shared/util/lru';

export interface RevisionCacheOptions {
  maxEntries?: number;
  maxBytes?: number;
}

/**
 * Content cache keyed by repository + blob (or commit:path). Metadata for a file's history is
 * held by the session (it is small); only contents are budgeted here.
 */
export class RevisionCache {
  private readonly contents: LruCache<RevisionContent>;

  constructor(options: RevisionCacheOptions = {}) {
    this.contents = new LruCache<RevisionContent>({
      maxEntries: options.maxEntries ?? 64,
      maxBytes: options.maxBytes ?? 24 * 1024 * 1024,
      sizeOf: (content) => estimateSize(content),
    });
  }

  static key(repoRoot: string, objectId: string): string {
    return `${repoRoot} ${objectId}`;
  }

  get(key: string): RevisionContent | undefined {
    return this.contents.get(key);
  }

  set(key: string, content: RevisionContent): void {
    this.contents.set(key, content);
  }

  get stats(): { hits: number; misses: number; entries: number; bytes: number } {
    const { hits, misses } = this.contents.stats;
    return { hits, misses, entries: this.contents.size, bytes: this.contents.byteSize };
  }

  clear(): void {
    this.contents.clear();
  }
}

function estimateSize(content: RevisionContent): number {
  switch (content.kind) {
    case 'text':
      // UTF-16 strings ≈ 2 bytes per char plus per-line array overhead.
      return content.byteLength * 2 + content.lines.length * 16 + 128;
    case 'binary':
    case 'tooLarge':
    case 'missing':
      return 128;
  }
}
