import { describe, expect, it } from 'vitest';
import { diffLines } from '../../src/shared/diff/lineDiff';
import { buildLineMap } from '../../src/shared/mapping/lineMap';
import type { RevisionView } from '../../src/shared/messages/protocol';
import { buildRows } from '../../src/webview/rendering/rows';

function view(prev: string[] | undefined, cur: string[]): RevisionView {
  const v: RevisionView = {
    id: 'cur',
    simplified: false,
    content: { kind: 'text', id: 'cur', path: 'a.ts', lines: cur, eol: 'LF', byteLength: 0 },
  };
  if (prev) {
    const diff = diffLines(prev, cur);
    const deletedLines: string[] = [];
    for (const op of diff.ops) {
      if (op.type === 'delete' || op.type === 'replace') {
        deletedLines.push(...prev.slice(op.aStart, op.aStart + op.aLen));
      }
    }
    v.diffFromPrevious = {
      previousId: 'prev',
      ops: diff.ops,
      deletedLines,
      map: buildLineMap(prev, cur, diff),
    };
  }
  return v;
}

describe('buildRows', () => {
  it('renders plain context rows without a diff', () => {
    const model = buildRows(view(undefined, ['a', 'b']), true);
    expect(model.rows.map((r) => [r.kind, r.line, r.text])).toEqual([
      ['context', 0, 'a'],
      ['context', 1, 'b'],
    ]);
    expect(model.rowOfLine).toEqual([0, 1]);
  });

  it('interleaves ghost rows where lines were removed and marks added lines', () => {
    const model = buildRows(view(['a', 'old', 'b'], ['a', 'new1', 'new2', 'b', 'tail']), true);
    expect(model.rows.map((r) => [r.kind, r.text])).toEqual([
      ['context', 'a'],
      ['ghost', 'old'],
      ['added', 'new1'],
      ['added', 'new2'],
      ['context', 'b'],
      ['added', 'tail'],
    ]);
    // Content line 3 ('b') is rendered at row 4 because of the ghost row.
    expect(model.rowOfLine).toEqual([0, 2, 3, 4, 5]);
    expect(model.lineCount).toBe(5);
  });

  it('omits ghost rows when disabled but keeps line numbering', () => {
    const model = buildRows(view(['a', 'old', 'b'], ['a', 'b']), false);
    expect(model.rows.map((r) => r.kind)).toEqual(['context', 'context']);
    expect(model.rowOfLine).toEqual([0, 1]);
  });

  it('returns an empty model for non-text content', () => {
    const model = buildRows(
      {
        id: 'x',
        simplified: false,
        content: { kind: 'binary', id: 'x', path: 'p', byteLength: 1 },
      },
      true,
    );
    expect(model.rows).toEqual([]);
  });
});
