import { describe, expect, it } from 'vitest';
import { LruCache } from '../../src/shared/util/lru';

describe('LruCache', () => {
  it('evicts the least recently used entry when maxEntries is exceeded', () => {
    const cache = new LruCache<number>({ maxEntries: 2 });
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.get('a')).toBe(1); // a becomes most recent
    cache.set('c', 3);
    expect(cache.has('b')).toBe(false);
    expect(cache.has('a')).toBe(true);
    expect(cache.has('c')).toBe(true);
  });

  it('respects a byte budget using sizeOf', () => {
    const evicted: string[] = [];
    const cache = new LruCache<string>({
      maxEntries: 100,
      maxBytes: 10,
      sizeOf: (v) => v.length,
      onEvict: (k) => evicted.push(k),
    });
    cache.set('a', 'xxxx');
    cache.set('b', 'xxxx');
    cache.set('c', 'xxxx'); // 12 bytes > 10 → evict a
    expect(evicted).toEqual(['a']);
    expect(cache.byteSize).toBe(8);
  });

  it('never evicts a single oversized entry', () => {
    const cache = new LruCache<string>({ maxEntries: 5, maxBytes: 3, sizeOf: (v) => v.length });
    cache.set('big', 'xxxxxxxx');
    expect(cache.get('big')).toBe('xxxxxxxx');
  });

  it('tracks hits and misses; peek does not count', () => {
    const cache = new LruCache<number>({ maxEntries: 2 });
    cache.set('a', 1);
    cache.get('a');
    cache.get('zzz');
    cache.peek('a');
    expect(cache.stats).toEqual({ hits: 1, misses: 1 });
  });

  it('replaces existing values and updates byte accounting', () => {
    const cache = new LruCache<string>({ maxEntries: 5, sizeOf: (v) => v.length });
    cache.set('a', 'xx');
    cache.set('a', 'xxxxx');
    expect(cache.byteSize).toBe(5);
    expect(cache.size).toBe(1);
    expect(cache.delete('a')).toBe(true);
    expect(cache.byteSize).toBe(0);
  });

  it('rejects invalid maxEntries', () => {
    expect(() => new LruCache<number>({ maxEntries: 0 })).toThrow(RangeError);
  });
});
