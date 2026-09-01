import { cleanup, render } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RevisionMeta } from '../../src/shared/models/revision';
import { RevisionDeck, slotFor } from '../../src/webview/components/RevisionDeck';
import { applyMessage, resetStore, setActive } from '../../src/webview/state/store';

const meta = (id: string): RevisionMeta => ({
  id,
  kind: 'commit',
  parents: [],
  author: { name: 'a' },
  authorDate: 0,
  committerDate: 0,
  subject: `subject ${id}`,
  body: '',
  path: 'a.ts',
  changeKind: 'M',
  isMerge: false,
});

const ids = ['r0', 'r1', 'r2', 'r3', 'r4', 'r5'];

function offsetsByCard(container: HTMLElement): Record<string, string> {
  const out: Record<string, string> = {};
  for (const card of container.querySelectorAll<HTMLElement>('.ctm-card')) {
    out[card.getAttribute('aria-label')?.split(':')[0]?.replace('Revision ', '') ?? '?'] =
      card.dataset['slot'] ?? '';
  }
  return out;
}

describe('RevisionDeck', () => {
  afterEach(() => cleanup());
  beforeEach(() => {
    resetStore();
    applyMessage({
      type: 'history',
      payload: { revisions: ids.map(meta), hasMore: false, loadingMore: false, activeIndex: 0 },
    });
  });

  it('renders the active card in slot 0 with older cards below', async () => {
    const { container, findAllByRole } = render(<RevisionDeck />);
    await findAllByRole('article', { hidden: true });
    expect(offsetsByCard(container as HTMLElement)).toEqual({
      r0: '0',
      r1: '1',
      r2: '2',
      r3: 'hidden-older',
    });
    const active = container.querySelector('.ctm-card-active');
    expect(active?.getAttribute('aria-hidden')).toBe('false');
    expect(container.querySelectorAll('.ctm-card-background').length).toBe(3);
  });

  it('shifts slots when the active revision changes (same nodes, new offsets)', async () => {
    const { container, findAllByRole, rerender } = render(<RevisionDeck />);
    await findAllByRole('article', { hidden: true });
    setActive(2);
    rerender(<RevisionDeck />);
    await findAllByRole('article', { hidden: true });
    expect(offsetsByCard(container as HTMLElement)).toEqual({
      r0: 'hidden-newer',
      r1: '-1',
      r2: '0',
      r3: '1',
      r4: '2',
      r5: 'hidden-older',
    });
  });

  it('activates a background card on click', async () => {
    const { container, findAllByRole, rerender } = render(<RevisionDeck />);
    await findAllByRole('article', { hidden: true });
    const older = container.querySelector<HTMLElement>('.ctm-card[data-slot="1"]');
    older?.click();
    rerender(<RevisionDeck />);
    await findAllByRole('article', { hidden: true });
    expect(container.querySelector('.ctm-card-active')?.getAttribute('aria-label')).toContain('r1');
  });

  it('maps offsets to slots', () => {
    expect(slotFor(-2)).toBe('hidden-newer');
    expect(slotFor(-1)).toBe('-1');
    expect(slotFor(0)).toBe('0');
    expect(slotFor(2)).toBe('2');
    expect(slotFor(3)).toBe('hidden-older');
  });
});
