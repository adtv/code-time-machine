import { describe, expect, it } from 'vitest';
import {
  applyOps,
  diffLines,
  internLines,
  normalizeLine,
  normalizeOps,
  type DiffOp,
} from '../../src/shared/diff/lineDiff';

/** Deterministic PRNG (mulberry32) for property tests. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function checkCoverage(a: string[], b: string[], ops: DiffOp[]): void {
  let ai = 0;
  let bi = 0;
  for (const op of ops) {
    expect(op.aStart).toBe(ai);
    expect(op.bStart).toBe(bi);
    ai += op.aLen;
    bi += op.bLen;
    if (op.type === 'equal') {
      expect(op.aLen).toBe(op.bLen);
      expect(op.aLen).toBeGreaterThan(0);
    }
    if (op.type === 'insert') {
      expect(op.aLen).toBe(0);
    }
    if (op.type === 'delete') {
      expect(op.bLen).toBe(0);
    }
    if (op.type === 'replace') {
      expect(op.aLen).toBeGreaterThan(0);
      expect(op.bLen).toBeGreaterThan(0);
    }
  }
  expect(ai).toBe(a.length);
  expect(bi).toBe(b.length);
}

describe('normalizeLine / internLines', () => {
  it('strips a trailing CR always and collapses whitespace on demand', () => {
    expect(normalizeLine('abc\r', false)).toBe('abc');
    expect(normalizeLine('  a   b \t c ', true)).toBe('a b c');
    expect(normalizeLine('  a   b ', false)).toBe('  a   b ');
  });

  it('interns equal lines to the same id', () => {
    const { ia, ib } = internLines(['x', 'y'], ['y', 'x', 'z'], false);
    expect(ia[0]).toBe(ib[1]);
    expect(ia[1]).toBe(ib[0]);
    expect(ib[2]).not.toBe(ia[0]);
  });
});

describe('diffLines', () => {
  it('returns a single equal op for identical inputs and nothing for empty ones', () => {
    const d = diffLines(['a', 'b'], ['a', 'b']);
    expect(d.ops).toEqual([{ type: 'equal', aStart: 0, aLen: 2, bStart: 0, bLen: 2 }]);
    expect(d.equalLines).toBe(2);
    expect(diffLines([], []).ops).toEqual([]);
    expect(diffLines(['a'], []).ops).toEqual([
      { type: 'delete', aStart: 0, aLen: 1, bStart: 0, bLen: 0 },
    ]);
    expect(diffLines([], ['a']).ops).toEqual([
      { type: 'insert', aStart: 0, aLen: 0, bStart: 0, bLen: 1 },
    ]);
  });

  it('detects a middle insertion', () => {
    const d = diffLines(['A', 'B', 'C', 'D'], ['A', 'B', 'X', 'Y', 'C', 'D']);
    expect(d.ops).toEqual([
      { type: 'equal', aStart: 0, aLen: 2, bStart: 0, bLen: 2 },
      { type: 'insert', aStart: 2, aLen: 0, bStart: 2, bLen: 2 },
      { type: 'equal', aStart: 2, aLen: 2, bStart: 4, bLen: 2 },
    ]);
  });

  it('detects a deletion', () => {
    const d = diffLines(['A', 'B', 'C', 'D'], ['A', 'D']);
    expect(d.ops).toEqual([
      { type: 'equal', aStart: 0, aLen: 1, bStart: 0, bLen: 1 },
      { type: 'delete', aStart: 1, aLen: 2, bStart: 1, bLen: 0 },
      { type: 'equal', aStart: 3, aLen: 1, bStart: 1, bLen: 1 },
    ]);
  });

  it('folds interleaved edits into a replace block', () => {
    const d = diffLines(['a', 'x1', 'x2', 'b'], ['a', 'y1', 'y2', 'y3', 'b']);
    expect(d.ops).toEqual([
      { type: 'equal', aStart: 0, aLen: 1, bStart: 0, bLen: 1 },
      { type: 'replace', aStart: 1, aLen: 2, bStart: 1, bLen: 3 },
      { type: 'equal', aStart: 3, aLen: 1, bStart: 4, bLen: 1 },
    ]);
  });

  it('uses patience anchors so repeated lines (braces) do not mislead', () => {
    const a = ['function f() {', '  a();', '}', '', 'function g() {', '  b();', '}'];
    const b = [
      'function f() {',
      '  a();',
      '  a2();',
      '}',
      '',
      'function h() {',
      '  c();',
      '}',
      '',
      'function g() {',
      '  b();',
      '}',
    ];
    const d = diffLines(a, b);
    expect(applyOps(a, b, d.ops)).toEqual(b);
    // Both function bodies survive as equal lines.
    expect(d.equalLines).toBe(a.length);
  });

  it('treats whitespace-only differences as equal when asked', () => {
    const a = ['foo( a,b )', '\tbar();'];
    const b = ['foo( a, b )', '    bar();'];
    expect(diffLines(a, b).equalLines).toBe(0);
    const d = diffLines(a, b, { ignoreWhitespace: true });
    expect(d.equalLines).toBe(1); // 'bar();' — 'foo( a,b )' vs 'foo( a, b )' differ beyond whitespace collapse
  });

  it('ignores CRLF vs LF differences', () => {
    const a = ['a\r', 'b\r', 'c\r'];
    const b = ['a', 'b', 'c'];
    expect(diffLines(a, b).equalLines).toBe(3);
  });

  it('degrades to a bulk replace when the edit distance bound is exceeded', () => {
    const a = Array.from({ length: 50 }, (_, i) => `a${i}`);
    const b = Array.from({ length: 50 }, (_, i) => `b${i}`);
    const d = diffLines(a, b, { maxEditDistance: 10 });
    expect(d.degraded).toBe(true);
    expect(d.ops).toEqual([{ type: 'replace', aStart: 0, aLen: 50, bStart: 0, bLen: 50 }]);
    const exact = diffLines(a, b);
    expect(exact.degraded).toBe(false);
    expect(applyOps(a, b, exact.ops)).toEqual(b);
  });

  it('property: applying the ops to a always reproduces b', () => {
    const random = rng(42);
    const alphabet = ['x', 'y', 'z', '{', '}'];
    for (let iter = 0; iter < 600; iter++) {
      const n = Math.floor(random() * 14);
      const m = Math.floor(random() * 14);
      const a = Array.from(
        { length: n },
        () => alphabet[Math.floor(random() * alphabet.length)] ?? 'x',
      );
      const b = Array.from(
        { length: m },
        () => alphabet[Math.floor(random() * alphabet.length)] ?? 'x',
      );
      const d = diffLines(a, b);
      expect(applyOps(a, b, d.ops)).toEqual(b);
      checkCoverage(a, b, d.ops);
      expect(d.degraded).toBe(false);
    }
  });

  it('property: mutated copies of a realistic file diff back correctly and fast', () => {
    const random = rng(7);
    const base = Array.from({ length: 5000 }, (_, i) =>
      i % 7 === 0 ? '}' : i % 5 === 0 ? '  return value;' : `  const v${i} = compute(${i});`,
    );
    const mutated = [...base];
    for (let k = 0; k < 200; k++) {
      const pos = Math.floor(random() * mutated.length);
      const roll = random();
      if (roll < 0.33) {
        mutated.splice(pos, 1);
      } else if (roll < 0.66) {
        mutated.splice(pos, 0, `  inserted_${k}();`);
      } else {
        mutated[pos] = `  changed_${k}();`;
      }
    }
    const started = performance.now();
    const d = diffLines(base, mutated);
    const elapsed = performance.now() - started;
    expect(applyOps(base, mutated, d.ops)).toEqual(mutated);
    checkCoverage(base, mutated, d.ops);
    expect(d.equalLines).toBeGreaterThan(4500);
    expect(elapsed).toBeLessThan(500);
  });
});

describe('normalizeOps', () => {
  it('merges contiguous equals and folds edits between them', () => {
    const ops: DiffOp[] = [
      { type: 'equal', aStart: 0, aLen: 1, bStart: 0, bLen: 1 },
      { type: 'equal', aStart: 1, aLen: 1, bStart: 1, bLen: 1 },
      { type: 'delete', aStart: 2, aLen: 1, bStart: 2, bLen: 0 },
      { type: 'insert', aStart: 3, aLen: 0, bStart: 2, bLen: 1 },
      { type: 'delete', aStart: 3, aLen: 1, bStart: 3, bLen: 0 },
    ];
    expect(normalizeOps(ops)).toEqual([
      { type: 'equal', aStart: 0, aLen: 2, bStart: 0, bLen: 2 },
      { type: 'replace', aStart: 2, aLen: 2, bStart: 2, bLen: 1 },
    ]);
  });
});
