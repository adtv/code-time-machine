import { cleanup, fireEvent, render } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RevisionMeta } from '../../src/shared/models/revision';
import { Timeline, dayLabel, groupByDay, magnitudeOf } from '../../src/webview/components/Timeline';
import { activeIndex, applyMessage, resetStore } from '../../src/webview/state/store';

const DAY = 86_400_000;
const now = Date.UTC(2026, 8, 1, 15, 0, 0);

const meta = (id: string, daysAgo: number, add = 0, del = 0): RevisionMeta => ({
  id,
  kind: 'commit',
  parents: [],
  author: { name: 'Ada' },
  authorDate: now - daysAgo * DAY,
  committerDate: now - daysAgo * DAY,
  subject: `subject ${id}`,
  body: '',
  path: 'a.ts',
  changeKind: 'M',
  isMerge: false,
  stats: { additions: add, deletions: del, binary: false },
});

describe('timeline helpers', () => {
  it('buckets magnitudes', () => {
    expect(magnitudeOf(meta('a', 0, 0, 0))).toBe('none');
    expect(magnitudeOf(meta('a', 0, 2, 1))).toBe('small');
    expect(magnitudeOf(meta('a', 0, 20, 10))).toBe('medium');
    expect(magnitudeOf(meta('a', 0, 80, 10))).toBe('large');
    const noStats = meta('a', 0);
    delete noStats.stats;
    expect(magnitudeOf(noStats)).toBe('none');
  });

  it('labels days relative to now', () => {
    expect(dayLabel(now - 60_000, now)).toBe('Today');
    expect(dayLabel(now - DAY, now)).toBe('Yesterday');
    expect(dayLabel(now - 10 * DAY, now)).toMatch(/Aug/u);
    expect(dayLabel(Date.UTC(2020, 0, 5), now)).toMatch(/2020/u);
  });

  it('groups consecutive revisions by day', () => {
    const groups = groupByDay([meta('a', 0), meta('b', 0), meta('c', 1), meta('d', 9)], now);
    expect(groups.map((g) => [g.label, g.items.length])).toEqual([
      ['Today', 2],
      ['Yesterday', 1],
      [expect.stringMatching(/Aug/u), 1],
    ]);
  });
});

describe('<Timeline />', () => {
  afterEach(() => cleanup());
  beforeEach(() => {
    resetStore();
    applyMessage({
      type: 'history',
      payload: {
        revisions: [meta('a', 0, 1, 0), meta('b', 1, 30, 2), meta('c', 5, 200, 100)],
        hasMore: true,
        loadingMore: false,
        activeIndex: 0,
      },
    });
  });

  it('renders one option per revision with the active one selected', () => {
    const { getAllByRole, getByRole } = render(<Timeline />);
    const options = getAllByRole('option');
    expect(options).toHaveLength(3);
    expect(options[0]?.getAttribute('aria-selected')).toBe('true');
    expect(getByRole('listbox').getAttribute('aria-activedescendant')).toBe('ctm-tl-0');
    expect(options[2]?.querySelector('.ctm-dot-large')).not.toBeNull();
    expect(options[0]?.getAttribute('title')).toContain('subject a');
  });

  it('selects on click and navigates with the keyboard', async () => {
    const { getAllByRole, getByRole, rerender } = render(<Timeline />);
    fireEvent.click(getAllByRole('option')[2]!);
    expect(activeIndex.value).toBe(2);
    rerender(<Timeline />);
    fireEvent.keyDown(getByRole('listbox'), { key: 'ArrowUp' });
    expect(activeIndex.value).toBe(1);
    fireEvent.keyDown(getByRole('listbox'), { key: 'Home' });
    expect(activeIndex.value).toBe(0);
    fireEvent.keyDown(getByRole('listbox'), { key: 'End' });
    expect(activeIndex.value).toBe(2);
    await Promise.resolve();
  });

  it('offers to load more when the history is not complete', () => {
    const { getByRole } = render(<Timeline />);
    expect(getByRole('button', { name: /load older commits/iu })).toBeTruthy();
  });
});
