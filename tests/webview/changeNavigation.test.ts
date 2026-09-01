import { describe, expect, it } from 'vitest';
import { diffLines } from '../../src/shared/diff/lineDiff';
import { buildLineMap } from '../../src/shared/mapping/lineMap';
import type { RevisionView } from '../../src/shared/messages/protocol';
import {
  nearestChangeIndex,
  nextChangeIndex,
  previousChangeIndex,
} from '../../src/webview/interaction/changeNavigation';
import { buildRows, type ChangeBlock } from '../../src/webview/rendering/rows';

function view(prev: string[], cur: string[]): RevisionView {
  const diff = diffLines(prev, cur);
  const deletedLines: string[] = [];
  for (const op of diff.ops) {
    if (op.type === 'delete' || op.type === 'replace') {
      deletedLines.push(...prev.slice(op.aStart, op.aStart + op.aLen));
    }
  }
  return {
    id: 'cur',
    simplified: false,
    content: { kind: 'text', id: 'cur', path: 'a.ts', lines: cur, eol: 'LF', byteLength: 0 },
    diffFromPrevious: {
      previousId: 'prev',
      ops: diff.ops,
      deletedLines,
      map: buildLineMap(prev, cur, diff),
    },
  };
}

const prev = ['a', 'b', 'old1', 'c', 'd', 'e', 'gone', 'f', 'g'];
const cur = ['a', 'b', 'new1', 'new2', 'c', 'd', 'e', 'f', 'g', 'tail'];

describe('change blocks in the row model', () => {
  it('groups contiguous added/ghost rows into blocks (ghost lines visible)', () => {
    const model = buildRows(view(prev, cur), true);
    // rows: a b ghost(old1) new1 new2 c d e ghost(gone) f g tail
    expect(model.blocks).toEqual<ChangeBlock[]>([
      { startRow: 2, rowCount: 3, added: 2, removed: 1 },
      { startRow: 8, rowCount: 1, added: 0, removed: 1 },
      { startRow: 11, rowCount: 1, added: 1, removed: 0 },
    ]);
  });

  it('keeps zero-row blocks for hidden pure deletions', () => {
    const model = buildRows(view(prev, cur), false);
    // rows: a b new1 new2 c d e f g tail — deletion of 'gone' sits between e and f (row 7)
    expect(model.blocks).toEqual<ChangeBlock[]>([
      { startRow: 2, rowCount: 2, added: 2, removed: 1 },
      { startRow: 7, rowCount: 0, added: 0, removed: 1 },
      { startRow: 9, rowCount: 1, added: 1, removed: 0 },
    ]);
  });

  it('has no blocks without a previous revision', () => {
    const v = view(prev, cur);
    delete v.diffFromPrevious;
    expect(buildRows(v, true).blocks).toEqual([]);
  });
});

describe('change navigation indices', () => {
  const blocks: ChangeBlock[] = [
    { startRow: 2, rowCount: 3, added: 2, removed: 1 },
    { startRow: 8, rowCount: 1, added: 0, removed: 1 },
    { startRow: 11, rowCount: 1, added: 1, removed: 0 },
  ];

  it('finds the next block after the centre and wraps', () => {
    expect(nextChangeIndex(blocks, 0)).toBe(0);
    expect(nextChangeIndex(blocks, 3)).toBe(1); // inside block 0 → next is block 1
    expect(nextChangeIndex(blocks, 8)).toBe(2);
    expect(nextChangeIndex(blocks, 11)).toBe(0); // wrap
    expect(nextChangeIndex([], 5)).toBe(-1);
  });

  it('finds the previous block before the centre and wraps', () => {
    expect(previousChangeIndex(blocks, 12)).toBe(2); // block 2 (row 11) ends before row 12
    expect(previousChangeIndex(blocks, 11)).toBe(1); // centre inside block 2 → the one before it
    expect(previousChangeIndex(blocks, 3)).toBe(2); // wrap: nothing ends before row 3
    expect(previousChangeIndex(blocks, 8)).toBe(0);
    expect(previousChangeIndex([], 5)).toBe(-1);
  });

  it('reports the nearest block', () => {
    expect(nearestChangeIndex(blocks, 0)).toBe(0);
    expect(nearestChangeIndex(blocks, 6)).toBe(0); // 6 is 2 away from block0 end (4), 2 away from block1 start → tie → first
    expect(nearestChangeIndex(blocks, 7)).toBe(1);
    expect(nearestChangeIndex(blocks, 30)).toBe(2);
    expect(nearestChangeIndex([], 3)).toBe(-1);
  });
});
