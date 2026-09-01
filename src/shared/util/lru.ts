/**
 * Small LRU cache with an optional byte budget. `sizeOf` lets callers account for large values
 * (e.g. file contents) so that memory, not only entry count, is bounded.
 */
export interface LruOptions<V> {
  maxEntries: number;
  maxBytes?: number;
  sizeOf?: (value: V) => number;
  onEvict?: (key: string, value: V) => void;
}

export class LruCache<V> {
  private readonly map = new Map<string, { value: V; size: number }>();
  private bytes = 0;
  private hitCount = 0;
  private missCount = 0;

  constructor(private readonly options: LruOptions<V>) {
    if (options.maxEntries < 1) {
      throw new RangeError('maxEntries must be >= 1');
    }
  }

  get size(): number {
    return this.map.size;
  }

  get byteSize(): number {
    return this.bytes;
  }

  get stats(): { hits: number; misses: number } {
    return { hits: this.hitCount, misses: this.missCount };
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  get(key: string): V | undefined {
    const entry = this.map.get(key);
    if (!entry) {
      this.missCount++;
      return undefined;
    }
    this.hitCount++;
    // Refresh recency: Map preserves insertion order, so delete + set moves it to the end.
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  /** Like `get` but does not affect recency or statistics. */
  peek(key: string): V | undefined {
    return this.map.get(key)?.value;
  }

  set(key: string, value: V): void {
    const size = this.options.sizeOf ? this.options.sizeOf(value) : 1;
    const existing = this.map.get(key);
    if (existing) {
      this.bytes -= existing.size;
      this.map.delete(key);
    }
    this.map.set(key, { value, size });
    this.bytes += size;
    this.evictIfNeeded();
  }

  delete(key: string): boolean {
    const entry = this.map.get(key);
    if (!entry) {
      return false;
    }
    this.map.delete(key);
    this.bytes -= entry.size;
    return true;
  }

  clear(): void {
    if (this.options.onEvict) {
      for (const [key, entry] of this.map) {
        this.options.onEvict(key, entry.value);
      }
    }
    this.map.clear();
    this.bytes = 0;
  }

  keys(): IterableIterator<string> {
    return this.map.keys();
  }

  private evictIfNeeded(): void {
    const { maxEntries, maxBytes, onEvict } = this.options;
    while (this.map.size > maxEntries || (maxBytes !== undefined && this.bytes > maxBytes)) {
      if (this.map.size <= 1 && this.map.size <= maxEntries) {
        // Never evict the only (just inserted) entry solely because it exceeds the byte budget.
        break;
      }
      const oldest = this.map.entries().next();
      if (oldest.done) {
        break;
      }
      const [key, entry] = oldest.value;
      this.map.delete(key);
      this.bytes -= entry.size;
      onEvict?.(key, entry.value);
    }
  }
}
