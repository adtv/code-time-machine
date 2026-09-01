/**
 * Line-based diff engine.
 *
 * Strategy (see docs/LINE_MAPPING.md):
 *   1. normalise lines (strip CR, optionally collapse whitespace) and intern them to integers;
 *   2. trim common prefix/suffix;
 *   3. patience: lines unique in both sides act as anchors (longest increasing subsequence),
 *      recursing into the gaps;
 *   4. gaps without anchors use a bounded Myers O(ND) search; if the bound is exceeded the gap is
 *      emitted as one bulk `replace` and the diff is flagged `degraded`.
 *
 * The output is a compact, ordered list of operations that fully covers both inputs.
 */

export interface DiffOptions {
  /** Treat lines that differ only in whitespace as equal. */
  ignoreWhitespace?: boolean;
  /** Maximum Myers edit distance per anchor-free gap before degrading to a bulk replace. */
  maxEditDistance?: number;
  /** Gaps larger than this (lines on both sides) skip Myers entirely. */
  maxMyersSegment?: number;
}

export type DiffOpType = 'equal' | 'insert' | 'delete' | 'replace';

export interface DiffOp {
  type: DiffOpType;
  aStart: number;
  aLen: number;
  bStart: number;
  bLen: number;
}

export interface LineDiff {
  ops: DiffOp[];
  aLength: number;
  bLength: number;
  /** Lines matched exactly (after normalisation). */
  equalLines: number;
  /** True when some gap exceeded the search bound and was emitted as a bulk replace. */
  degraded: boolean;
}

const DEFAULT_MAX_EDIT_DISTANCE = 1000;
const DEFAULT_MAX_MYERS_SEGMENT = 6000;

export function normalizeLine(line: string, ignoreWhitespace: boolean): string {
  const withoutCr = line.endsWith('\r') ? line.slice(0, -1) : line;
  return ignoreWhitespace ? withoutCr.trim().replace(/\s+/gu, ' ') : withoutCr;
}

/** Interns both inputs into integer arrays where equal ids mean equal (normalised) lines. */
export function internLines(
  a: readonly string[],
  b: readonly string[],
  ignoreWhitespace: boolean,
): { ia: Int32Array; ib: Int32Array } {
  const ids = new Map<string, number>();
  const intern = (lines: readonly string[]): Int32Array => {
    const out = new Int32Array(lines.length);
    for (let i = 0; i < lines.length; i++) {
      const key = normalizeLine(lines[i] ?? '', ignoreWhitespace);
      let id = ids.get(key);
      if (id === undefined) {
        id = ids.size;
        ids.set(key, id);
      }
      out[i] = id;
    }
    return out;
  };
  return { ia: intern(a), ib: intern(b) };
}

interface Ctx {
  ia: Int32Array;
  ib: Int32Array;
  ops: DiffOp[];
  degraded: boolean;
  maxD: number;
  maxSegment: number;
}

export function diffLines(
  a: readonly string[],
  b: readonly string[],
  options: DiffOptions = {},
): LineDiff {
  const { ia, ib } = internLines(a, b, options.ignoreWhitespace ?? false);
  const ctx: Ctx = {
    ia,
    ib,
    ops: [],
    degraded: false,
    maxD: options.maxEditDistance ?? DEFAULT_MAX_EDIT_DISTANCE,
    maxSegment: options.maxMyersSegment ?? DEFAULT_MAX_MYERS_SEGMENT,
  };
  diffSegment(ctx, 0, ia.length, 0, ib.length);
  const ops = normalizeOps(ctx.ops);
  let equalLines = 0;
  for (const op of ops) {
    if (op.type === 'equal') {
      equalLines += op.aLen;
    }
  }
  return { ops, aLength: a.length, bLength: b.length, equalLines, degraded: ctx.degraded };
}

function push(
  ctx: Ctx,
  type: DiffOpType,
  aStart: number,
  aLen: number,
  bStart: number,
  bLen: number,
): void {
  if (aLen === 0 && bLen === 0) {
    return;
  }
  ctx.ops.push({ type, aStart, aLen, bStart, bLen });
}

function diffSegment(ctx: Ctx, aLo: number, aHi: number, bLo: number, bHi: number): void {
  const { ia, ib } = ctx;
  // Common prefix.
  let prefix = 0;
  while (aLo + prefix < aHi && bLo + prefix < bHi && ia[aLo + prefix] === ib[bLo + prefix]) {
    prefix++;
  }
  if (prefix > 0) {
    push(ctx, 'equal', aLo, prefix, bLo, prefix);
    aLo += prefix;
    bLo += prefix;
  }
  // Common suffix (emitted after the middle).
  let suffix = 0;
  while (
    aHi - suffix > aLo &&
    bHi - suffix > bLo &&
    ia[aHi - 1 - suffix] === ib[bHi - 1 - suffix]
  ) {
    suffix++;
  }
  const aEnd = aHi - suffix;
  const bEnd = bHi - suffix;

  if (aLo === aEnd && bLo === bEnd) {
    // nothing in the middle
  } else if (aLo === aEnd) {
    push(ctx, 'insert', aLo, 0, bLo, bEnd - bLo);
  } else if (bLo === bEnd) {
    push(ctx, 'delete', aLo, aEnd - aLo, bLo, 0);
  } else {
    const anchors = uniqueAnchors(ia, aLo, aEnd, ib, bLo, bEnd);
    if (anchors.length === 0) {
      myersOrDegrade(ctx, aLo, aEnd, bLo, bEnd);
    } else {
      let pa = aLo;
      let pb = bLo;
      for (let i = 0; i < anchors.length; i += 2) {
        const ai = anchors[i] ?? pa;
        const bi = anchors[i + 1] ?? pb;
        diffSegment(ctx, pa, ai, pb, bi);
        push(ctx, 'equal', ai, 1, bi, 1);
        pa = ai + 1;
        pb = bi + 1;
      }
      diffSegment(ctx, pa, aEnd, pb, bEnd);
    }
  }

  if (suffix > 0) {
    push(ctx, 'equal', aEnd, suffix, bEnd, suffix);
  }
}

/**
 * Patience anchors: lines that occur exactly once in both ranges, kept in an order that is
 * increasing on both sides (longest increasing subsequence of b-positions sorted by a-position).
 * Returns a flat array [a0, b0, a1, b1, ...].
 */
function uniqueAnchors(
  ia: Int32Array,
  aLo: number,
  aHi: number,
  ib: Int32Array,
  bLo: number,
  bHi: number,
): number[] {
  const countA = new Map<number, number>();
  const indexA = new Map<number, number>();
  for (let i = aLo; i < aHi; i++) {
    const key = ia[i] ?? -1;
    countA.set(key, (countA.get(key) ?? 0) + 1);
    indexA.set(key, i);
  }
  const countB = new Map<number, number>();
  const indexB = new Map<number, number>();
  for (let j = bLo; j < bHi; j++) {
    const key = ib[j] ?? -1;
    if (countA.get(key) === 1) {
      countB.set(key, (countB.get(key) ?? 0) + 1);
      indexB.set(key, j);
    }
  }
  const pairsA: number[] = [];
  const pairsB: number[] = [];
  for (let i = aLo; i < aHi; i++) {
    const key = ia[i] ?? -1;
    if (countA.get(key) === 1 && countB.get(key) === 1) {
      pairsA.push(i);
      pairsB.push(indexB.get(key) ?? 0);
    }
  }
  if (pairsA.length === 0) {
    return [];
  }
  // LIS over pairsB (pairsA is already increasing).
  const tails: number[] = []; // indices into pairs
  const prev = new Int32Array(pairsB.length).fill(-1);
  for (let i = 0; i < pairsB.length; i++) {
    const value = pairsB[i] ?? 0;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if ((pairsB[tails[mid] ?? 0] ?? 0) < value) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    prev[i] = lo > 0 ? (tails[lo - 1] ?? -1) : -1;
    tails[lo] = i;
  }
  const result: number[] = [];
  let k = tails[tails.length - 1] ?? -1;
  while (k >= 0) {
    result.push(pairsA[k] ?? 0, pairsB[k] ?? 0);
    k = prev[k] ?? -1;
  }
  // Built backwards in pairs; reverse pairwise.
  const out: number[] = [];
  for (let i = result.length - 2; i >= 0; i -= 2) {
    out.push(result[i] ?? 0, result[i + 1] ?? 0);
  }
  return out;
}

function myersOrDegrade(ctx: Ctx, aLo: number, aEnd: number, bLo: number, bEnd: number): void {
  const n = aEnd - aLo;
  const m = bEnd - bLo;
  if (n + m <= ctx.maxSegment) {
    const ops = myers(ctx.ia, aLo, aEnd, ctx.ib, bLo, bEnd, ctx.maxD);
    if (ops) {
      for (const op of ops) {
        ctx.ops.push(op);
      }
      return;
    }
  }
  ctx.degraded = true;
  push(ctx, 'replace', aLo, n, bLo, m);
}

/**
 * Bounded Myers O(ND). Returns undefined when the edit distance exceeds `maxD`.
 * `trace[d]` stores the frontier after round d-1 for k in [-d-1, d+1] (index k + d + 1).
 */
function myers(
  ia: Int32Array,
  aLo: number,
  aEnd: number,
  ib: Int32Array,
  bLo: number,
  bEnd: number,
  maxD: number,
): DiffOp[] | undefined {
  const n = aEnd - aLo;
  const m = bEnd - bLo;
  const limit = Math.min(n + m, maxD);
  const offset = limit + 1;
  const v = new Int32Array(2 * offset + 2);
  v[offset + 1] = 0;
  const trace: Int32Array[] = [];
  for (let d = 0; d <= limit; d++) {
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && (v[offset + k - 1] ?? 0) < (v[offset + k + 1] ?? 0))) {
        x = v[offset + k + 1] ?? 0;
      } else {
        x = (v[offset + k - 1] ?? 0) + 1;
      }
      let y = x - k;
      while (x < n && y < m && ia[aLo + x] === ib[bLo + y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        return backtrack(trace, d, n, m, aLo, bLo);
      }
    }
  }
  return undefined;
}

function backtrack(
  trace: Int32Array[],
  finalD: number,
  n: number,
  m: number,
  aLo: number,
  bLo: number,
): DiffOp[] {
  const reversed: DiffOp[] = [];
  let x = n;
  let y = m;
  for (let d = finalD; d >= 0; d--) {
    if (d === 0) {
      if (x > 0) {
        reversed.push({ type: 'equal', aStart: aLo, aLen: x, bStart: bLo, bLen: x });
      }
      break;
    }
    const snapshot = trace[d];
    if (!snapshot) {
      break;
    }
    const at = (k: number): number => snapshot[k + d + 1] ?? 0;
    const k = x - y;
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    const midX = prevK === k + 1 ? prevX : prevX + 1;
    const midY = prevK === k + 1 ? prevY + 1 : prevY;
    if (x > midX) {
      reversed.push({
        type: 'equal',
        aStart: aLo + midX,
        aLen: x - midX,
        bStart: bLo + midY,
        bLen: x - midX,
      });
    }
    if (prevK === k + 1) {
      reversed.push({ type: 'insert', aStart: aLo + prevX, aLen: 0, bStart: bLo + prevY, bLen: 1 });
    } else {
      reversed.push({ type: 'delete', aStart: aLo + prevX, aLen: 1, bStart: bLo + prevY, bLen: 0 });
    }
    x = prevX;
    y = prevY;
  }
  return reversed.reverse();
}

/**
 * Coalesces consecutive equal ops and folds runs of inserts/deletes between equal regions into a
 * single insert, delete or replace block.
 */
export function normalizeOps(ops: readonly DiffOp[]): DiffOp[] {
  const out: DiffOp[] = [];
  let pending: DiffOp | undefined;

  const flushPending = (): void => {
    if (!pending) {
      return;
    }
    if (pending.aLen > 0 && pending.bLen > 0) {
      pending.type = 'replace';
    } else if (pending.aLen > 0) {
      pending.type = 'delete';
    } else {
      pending.type = 'insert';
    }
    out.push(pending);
    pending = undefined;
  };

  for (const op of ops) {
    if (op.type === 'equal') {
      flushPending();
      const last = out[out.length - 1];
      if (
        last?.type === 'equal' &&
        last.aStart + last.aLen === op.aStart &&
        last.bStart + last.bLen === op.bStart
      ) {
        last.aLen += op.aLen;
        last.bLen += op.bLen;
      } else {
        out.push({ ...op });
      }
      continue;
    }
    if (!pending) {
      pending = { ...op };
    } else {
      pending.aLen += op.aLen;
      pending.bLen += op.bLen;
    }
  }
  flushPending();
  return out;
}

/** Rebuilds `b` from `a` and the ops — used by tests and as a self-check. */
export function applyOps(
  a: readonly string[],
  b: readonly string[],
  ops: readonly DiffOp[],
): string[] {
  const out: string[] = [];
  for (const op of ops) {
    if (op.type === 'equal') {
      for (let i = 0; i < op.aLen; i++) {
        out.push(a[op.aStart + i] ?? '');
      }
    } else if (op.type !== 'delete') {
      for (let j = 0; j < op.bLen; j++) {
        out.push(b[op.bStart + j] ?? '');
      }
    }
  }
  return out;
}
