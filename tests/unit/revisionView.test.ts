import { describe, expect, it } from 'vitest';
import { buildRevisionView, collectDeletedLines } from '../../src/extension/session/revisionView';
import type { RevisionContent } from '../../src/shared/models/revision';

const text = (id: string, lines: string[]): RevisionContent => ({
  kind: 'text',
  id,
  path: 'a.ts',
  lines,
  eol: 'LF',
  byteLength: lines.join('\n').length,
});

describe('buildRevisionView', () => {
  const options = { ignoreWhitespace: false, maxRenderedLines: 8000 };

  it('includes diff, ghost lines and a previous→current map', () => {
    const previous = text('p', ['a', 'old1', 'old2', 'b']);
    const current = text('c', ['a', 'new', 'b', 'tail']);
    const view = buildRevisionView(current, previous, options);
    expect(view.id).toBe('c');
    expect(view.simplified).toBe(false);
    expect(view.diffFromPrevious?.previousId).toBe('p');
    expect(view.diffFromPrevious?.deletedLines).toEqual(['old1', 'old2']);
    expect(view.diffFromPrevious?.map.aLength).toBe(4);
    expect(view.diffFromPrevious?.map.bLength).toBe(4);
    expect(view.diffFromPrevious?.map.aToB[0]).toBe(0);
    expect(view.diffFromPrevious?.map.aToB[3]).toBe(2);
    expect(view.diffFromPrevious?.ops.map((o) => o.type)).toEqual([
      'equal',
      'replace',
      'equal',
      'insert',
    ]);
  });

  it('omits the diff when either side is not text', () => {
    const view = buildRevisionView(
      text('c', ['a']),
      { kind: 'missing', id: 'p', path: 'a.ts' },
      options,
    );
    expect(view.diffFromPrevious).toBeUndefined();
    const binary = buildRevisionView(
      { kind: 'binary', id: 'c', path: 'a.png', byteLength: 3 },
      text('p', ['a']),
      options,
    );
    expect(binary.diffFromPrevious).toBeUndefined();
    expect(binary.content.kind).toBe('binary');
  });

  it('flags simplified views and attaches highlight when provided', () => {
    const big = text(
      'c',
      Array.from({ length: 20 }, (_, i) => `l${i}`),
    );
    const view = buildRevisionView(
      big,
      undefined,
      { ignoreWhitespace: false, maxRenderedLines: 10 },
      {
        current: { palette: ['#fff'], lines: [] },
      },
    );
    expect(view.simplified).toBe(true);
    expect(view.highlight?.palette).toEqual(['#fff']);
  });

  it('collects deleted lines in order', () => {
    expect(collectDeletedLines(['a', 'b', 'c', 'd'], ['a', 'd'], false)).toEqual(['b', 'c']);
    expect(collectDeletedLines(['a\r', 'b\r'], ['a', 'b'], false)).toEqual([]);
  });
});
