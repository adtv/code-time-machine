import { describe, expect, it } from 'vitest';
import { RevisionCache } from '../../src/extension/cache/revisionCache';
import type { RevisionContent } from '../../src/shared/models/revision';

function text(id: string, lines: string[]): RevisionContent {
  return { kind: 'text', id, path: 'a.ts', lines, eol: 'LF', byteLength: lines.join('\n').length };
}

describe('RevisionCache', () => {
  it('stores and returns content, reporting hits/misses', () => {
    const cache = new RevisionCache({ maxEntries: 10 });
    const key = RevisionCache.key('/repo', 'blob1');
    expect(cache.get(key)).toBeUndefined();
    cache.set(key, text('c1', ['a']));
    expect(cache.get(key)?.kind).toBe('text');
    expect(cache.stats).toMatchObject({ hits: 1, misses: 1, entries: 1 });
  });

  it('keys are scoped per repository', () => {
    expect(RevisionCache.key('/a', 'x')).not.toBe(RevisionCache.key('/b', 'x'));
  });

  it('evicts by byte budget', () => {
    // Each entry is estimated at ~3 KB; a 7 KB budget holds two.
    const cache = new RevisionCache({ maxEntries: 100, maxBytes: 7000 });
    const big = text('c1', new Array<string>(50).fill('x'.repeat(20)));
    cache.set('k1', big);
    cache.set('k2', big);
    expect(cache.stats.entries).toBe(2);
    cache.set('k3', big);
    expect(cache.stats.entries).toBe(2);
    expect(cache.get('k1')).toBeUndefined();
    expect(cache.stats.bytes).toBeLessThanOrEqual(7000);
  });

  it('accounts small entries for non-text content and clears', () => {
    const cache = new RevisionCache({ maxEntries: 10 });
    cache.set('m', { kind: 'missing', id: 'x', path: 'p' });
    cache.set('b', { kind: 'binary', id: 'x', path: 'p', byteLength: 10 });
    expect(cache.stats.entries).toBe(2);
    cache.clear();
    expect(cache.stats.entries).toBe(0);
  });
});
