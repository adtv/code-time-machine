import { describe, expect, it } from 'vitest';
import { diffLines } from '../../src/shared/diff/lineDiff';
import { buildLineMap } from '../../src/shared/mapping/lineMap';
import type { RevisionView } from '../../src/shared/messages/protocol';
import {
  currentChangeIndex,
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

  it('tracks the current block by clamped scroll target (agrees with the jumps)', () => {
    // 60 rows × 20px, viewport 400px → maxScroll 800. Blocks near both edges.
    const edgeBlocks: ChangeBlock[] = [
      { startRow: 2, rowCount: 2, added: 2, removed: 0 }, // target 60-200 → clamped 0
      { startRow: 25, rowCount: 2, added: 1, removed: 1 }, // target 320
      { startRow: 50, rowCount: 4, added: 4, removed: 0 }, // target 840 → clamped 800
      { startRow: 58, rowCount: 2, added: 2, removed: 0 }, // target 990 → clamped 800
    ];
    const at = (scrollTop: number) => currentChangeIndex(edgeBlocks, 60, 20, 400, scrollTop);
    expect(at(0)).toBe(0); // top of the file → first block (tie at the top edge)
    expect(at(320)).toBe(1); // exactly centred on block 2
    expect(at(800)).toBe(3); // bottom of the file → LAST block, even though it cannot be centred
    expect(at(700)).toBe(2);
    expect(currentChangeIndex([], 60, 20, 400, 0)).toBe(-1);
    // A short file where nothing scrolls (maxScroll 0): first block wins.
    expect(currentChangeIndex(edgeBlocks.slice(0, 2), 10, 20, 400, 0)).toBe(0);
  });
});
