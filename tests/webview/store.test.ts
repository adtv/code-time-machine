import { beforeEach, describe, expect, it } from 'vitest';
import type { RevisionMeta } from '../../src/shared/models/revision';
import {
  activeIndex,
  activeRevision,
  applyMessage,
  empty,
  navigate,
  resetStore,
  revisions,
  setActive,
  views,
} from '../../src/webview/state/store';

const meta = (id: string): RevisionMeta => ({
  id,
  kind: 'commit',
  parents: [],
  author: { name: 'a' },
  authorDate: 0,
  committerDate: 0,
  subject: id,
  body: '',
  path: 'a.ts',
  changeKind: 'M',
  isMerge: false,
});

describe('webview store', () => {
  beforeEach(() => resetStore());

  it('applies history and active messages with clamping', () => {
    applyMessage({
      type: 'history',
      payload: {
        revisions: [meta('a'), meta('b'), meta('c')],
        hasMore: false,
        loadingMore: false,
        activeIndex: 7,
      },
    });
    expect(revisions.value).toHaveLength(3);
    expect(activeIndex.value).toBe(2);
    applyMessage({ type: 'active', payload: { index: 1 } });
    expect(activeRevision.value?.id).toBe('b');
  });

  it('stores revision views and clears errors on success', () => {
    applyMessage({ type: 'revisionError', payload: { id: 'a', code: 'X', message: 'boom' } });
    applyMessage({
      type: 'revision',
      payload: { id: 'a', simplified: false, content: { kind: 'missing', id: 'a', path: 'p' } },
    });
    expect(views.value.get('a')?.content.kind).toBe('missing');
  });

  it('navigates locally with clamping', () => {
    applyMessage({
      type: 'history',
      payload: {
        revisions: [meta('a'), meta('b')],
        hasMore: false,
        loadingMore: false,
        activeIndex: 0,
      },
    });
    navigate(+1);
    expect(activeIndex.value).toBe(1);
    navigate(+5);
    expect(activeIndex.value).toBe(1);
    setActive(-3);
    expect(activeIndex.value).toBe(0);
  });

  it('records empty states', () => {
    applyMessage({ type: 'empty', payload: { kind: 'notTracked', message: 'nope' } });
    expect(empty.value?.kind).toBe('notTracked');
  });
});
