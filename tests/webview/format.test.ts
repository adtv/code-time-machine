import { describe, expect, it } from 'vitest';
import type { RevisionMeta } from '../../src/shared/models/revision';
import { formatDuration, gapSincePrevious } from '../../src/webview/components/format';

const meta = (
  id: string,
  authorDate: number,
  kind: RevisionMeta['kind'] = 'commit',
): RevisionMeta => ({
  id,
  kind,
  parents: [],
  author: { name: 'a' },
  authorDate,
  committerDate: authorDate,
  subject: id,
  body: '',
  path: 'a.ts',
  changeKind: 'M',
  isMerge: false,
});

const H = 3_600_000;
const D = 24 * H;

describe('formatDuration', () => {
  it('picks a single sensible unit', () => {
    expect(formatDuration(30_000)).toBe('less than a minute');
    expect(formatDuration(5 * 60_000)).toBe('5 minutes');
    expect(formatDuration(1 * H)).toBe('1 hour');
    expect(formatDuration(7 * H)).toBe('7 hours');
    expect(formatDuration(3 * D)).toBe('3 days');
    expect(formatDuration(20 * D)).toBe('3 weeks');
    expect(formatDuration(100 * D)).toBe('3 months');
    expect(formatDuration(800 * D)).toBe('2.2 years');
    expect(formatDuration(-2 * D)).toBe('2 days');
  });
});

describe('gapSincePrevious', () => {
  const now = Date.UTC(2026, 8, 1, 12, 0, 0);

  it('describes the time between a commit and the previous entry', () => {
    const gap = gapSincePrevious(meta('b', now), meta('a', now - 2 * D));
    expect(gap?.text).toBe('2 days after previous');
    expect(gap?.title).toContain('Previous revision');
  });

  it('flags commits authored before the previous entry', () => {
    const gap = gapSincePrevious(meta('b', now - 5 * H), meta('a', now));
    expect(gap?.text).toMatch(/^authored 5 hours before previous/u);
  });

  it('measures the working tree against the last commit and handles the oldest revision', () => {
    const wt = gapSincePrevious(meta('WT', now, 'workingTree'), meta('a', now - 3 * H), now);
    expect(wt?.text).toBe('3 hours since last commit');
    expect(gapSincePrevious(meta('a', now), undefined)).toBeUndefined();
  });
});
