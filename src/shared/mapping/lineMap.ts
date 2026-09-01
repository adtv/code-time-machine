import type { DiffOp, LineDiff } from '../diff/lineDiff';
import { normalizeLine } from '../diff/lineDiff';

/**
 * LineMappingEngine: turns a line diff into a bidirectional correspondence between the lines of
 * two revisions, with a confidence per line. See docs/LINE_MAPPING.md.
 *
 * Types (numeric so the map stays compact across postMessage):
 *   0 unchanged  – exact match (confidence 1)
 *   1 modified   – paired inside a replaced block (confidence = similarity, or 0.3 when interpolated)
 *   2 inserted   – only exists on side b
 *   3 deleted    – only exists on side a
 */
export const MappingType = {
  unchanged: 0,
  modified: 1,
  inserted: 2,
  deleted: 3,
} as const;
export type MappingTypeCode = (typeof MappingType)[keyof typeof MappingType];

export interface LineMap {
  aLength: number;
  bLength: number;
  /** For each a-line, the matching b-line or -1. */
  aToB: number[];
  bToA: number[];
  aConfidence: number[];
  bConfidence: number[];
  aType: MappingTypeCode[];
  bType: MappingTypeCode[];
  /** Fraction of lines with a trustworthy correspondence (0..1). */
  overall: number;
  /** True when the mapping should be treated as approximate by consumers. */
  degraded: boolean;
}

export interface LineMapOptions {
  /** Minimum token similarity (Dice) to pair two lines inside a replaced block. */
  similarityThreshold?: number;
  /** Replaced blocks with aLen*bLen above this skip similarity pairing (interpolate only). */
  maxSimilarityBlock?: number;
  /** Below this overall score the map is flagged degraded. */
  degradedBelow?: number;
  ignoreWhitespace?: boolean;
}

const INTERPOLATED_CONFIDENCE = 0.3;
const FALLBACK_CONFIDENCE = 0.2;

export function buildLineMap(
  a: readonly string[],
  b: readonly string[],
  diff: LineDiff,
  options: LineMapOptions = {},
): LineMap {
  const threshold = options.similarityThreshold ?? 0.6;
  const maxBlock = options.maxSimilarityBlock ?? 250_000;
  const ignoreWhitespace = options.ignoreWhitespace ?? false;

  const map: LineMap = {
    aLength: a.length,
    bLength: b.length,
    aToB: new Array<number>(a.length).fill(-1),
    bToA: new Array<number>(b.length).fill(-1),
    aConfidence: new Array<number>(a.length).fill(0),
    bConfidence: new Array<number>(b.length).fill(0),
    aType: new Array<MappingTypeCode>(a.length).fill(MappingType.deleted),
    bType: new Array<MappingTypeCode>(b.length).fill(MappingType.inserted),
    overall: 0,
    degraded: false,
  };

  let score = 0;
  for (const op of diff.ops) {
    if (op.type === 'equal') {
      for (let i = 0; i < op.aLen; i++) {
        link(map, op.aStart + i, op.bStart + i, 1, MappingType.unchanged);
      }
      score += op.aLen;
    } else if (op.type === 'replace') {
      score += pairReplacedBlock(map, a, b, op, threshold, maxBlock, ignoreWhitespace);
    }
  }

  const denominator = Math.max(a.length, b.length);
  map.overall = denominator === 0 ? 1 : Math.min(1, score / denominator);
  map.degraded = map.overall < (options.degradedBelow ?? 0.15);
  return map;
}

function link(
  map: LineMap,
  ai: number,
  bi: number,
  confidence: number,
  type: MappingTypeCode,
): void {
  map.aToB[ai] = bi;
  map.bToA[bi] = ai;
  map.aConfidence[ai] = confidence;
  map.bConfidence[bi] = confidence;
  map.aType[ai] = type;
  map.bType[bi] = type;
}

/**
 * Pairs lines inside a replaced block: first by token similarity (monotonic greedy), then the
 * rest by linear interpolation between paired neighbours. Returns the confidence-weighted score
 * contributed by similarity pairs (interpolated lines do not count towards `overall`).
 */
function pairReplacedBlock(
  map: LineMap,
  a: readonly string[],
  b: readonly string[],
  op: DiffOp,
  threshold: number,
  maxBlock: number,
  ignoreWhitespace: boolean,
): number {
  let score = 0;
  const n = op.aLen;
  const m = op.bLen;
  if (n * m <= maxBlock) {
    const tokensA: Set<string>[] = [];
    const tokensB: Set<string>[] = [];
    for (let i = 0; i < n; i++) {
      tokensA.push(tokenize(normalizeLine(a[op.aStart + i] ?? '', ignoreWhitespace)));
    }
    for (let j = 0; j < m; j++) {
      tokensB.push(tokenize(normalizeLine(b[op.bStart + j] ?? '', ignoreWhitespace)));
    }
    let bPos = 0;
    for (let i = 0; i < n && bPos < m; i++) {
      let best = -1;
      let bestScore = threshold - 1e-9;
      const ta = tokensA[i];
      if (!ta) {
        continue;
      }
      for (let j = bPos; j < m; j++) {
        const tb = tokensB[j];
        if (!tb) {
          continue;
        }
        const s = dice(ta, tb);
        if (s > bestScore) {
          bestScore = s;
          best = j;
          if (s === 1) {
            break;
          }
        }
      }
      if (best >= 0) {
        link(map, op.aStart + i, op.bStart + best, bestScore, MappingType.modified);
        score += bestScore;
        bPos = best + 1;
      }
    }
  }
  interpolateBlock(map.aToB, map.aConfidence, map.aType, op.aStart, n, op.bStart, m);
  interpolateBlock(map.bToA, map.bConfidence, map.bType, op.bStart, m, op.aStart, n);
  return score;
}

/** Fills unmapped lines of a replaced block by interpolating between mapped neighbours. */
function interpolateBlock(
  toOther: number[],
  confidence: number[],
  types: MappingTypeCode[],
  start: number,
  len: number,
  otherStart: number,
  otherLen: number,
): void {
  if (otherLen === 0) {
    return;
  }
  for (let i = 0; i < len; i++) {
    const idx = start + i;
    if ((toOther[idx] ?? -1) >= 0) {
      continue;
    }
    // Nearest mapped neighbours inside the block (or the block boundaries).
    let prevIdx = -1;
    let prevTarget = otherStart - 1;
    for (let p = i - 1; p >= 0; p--) {
      const t = toOther[start + p] ?? -1;
      if (t >= 0) {
        prevIdx = p;
        prevTarget = t;
        break;
      }
    }
    let nextIdx = len;
    let nextTarget = otherStart + otherLen;
    for (let q = i + 1; q < len; q++) {
      const t = toOther[start + q] ?? -1;
      if (t >= 0) {
        nextIdx = q;
        nextTarget = t;
        break;
      }
    }
    const fraction = (i - prevIdx) / (nextIdx - prevIdx);
    const raw = prevTarget + fraction * (nextTarget - prevTarget);
    const target = clamp(Math.round(raw), otherStart, otherStart + otherLen - 1);
    toOther[idx] = target;
    confidence[idx] = INTERPOLATED_CONFIDENCE;
    types[idx] = MappingType.modified;
  }
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

const TOKEN_SPLIT = /[^\p{L}\p{N}_]+/u;

export function tokenize(line: string): Set<string> {
  const out = new Set<string>();
  for (const token of line.split(TOKEN_SPLIT)) {
    if (token.length > 0) {
      out.add(token);
    }
  }
  return out;
}

/** Sørensen–Dice coefficient over token sets. Two blank lines are considered identical. */
export function dice(x: Set<string>, y: Set<string>): number {
  if (x.size === 0 && y.size === 0) {
    return 1;
  }
  if (x.size === 0 || y.size === 0) {
    return 0;
  }
  let common = 0;
  const [small, large] = x.size <= y.size ? [x, y] : [y, x];
  for (const token of small) {
    if (large.has(token)) {
      common++;
    }
  }
  return (2 * common) / (x.size + y.size);
}

export interface MappedLine {
  line: number;
  confidence: number;
  /** True when the line has a direct correspondence (unchanged or modified pair). */
  direct: boolean;
}

/**
 * Resolves the counterpart of a line, falling back to an interpolated position between the
 * nearest mapped neighbours when the line itself has none (inserted/deleted lines).
 * Never throws; the result is always a valid line index on the other side (or 0 when empty).
 */
export function mapLine(map: LineMap, side: 'a' | 'b', line: number): MappedLine {
  const toOther = side === 'a' ? map.aToB : map.bToA;
  const confidence = side === 'a' ? map.aConfidence : map.bConfidence;
  const thisLen = side === 'a' ? map.aLength : map.bLength;
  const otherLen = side === 'a' ? map.bLength : map.aLength;
  if (otherLen === 0) {
    return { line: 0, confidence: 0, direct: false };
  }
  if (thisLen === 0) {
    return { line: 0, confidence: 0, direct: false };
  }
  const idx = clamp(line, 0, thisLen - 1);
  const direct = toOther[idx] ?? -1;
  if (direct >= 0) {
    return { line: direct, confidence: confidence[idx] ?? 0, direct: true };
  }
  let prev = -1;
  for (let p = idx - 1; p >= 0; p--) {
    if ((toOther[p] ?? -1) >= 0) {
      prev = p;
      break;
    }
  }
  let next = -1;
  for (let q = idx + 1; q < thisLen; q++) {
    if ((toOther[q] ?? -1) >= 0) {
      next = q;
      break;
    }
  }
  let target: number;
  if (prev >= 0 && next >= 0) {
    const pt = toOther[prev] ?? 0;
    const nt = toOther[next] ?? 0;
    target = pt + ((idx - prev) / (next - prev)) * (nt - pt);
  } else if (prev >= 0) {
    target = (toOther[prev] ?? 0) + (idx - prev);
  } else if (next >= 0) {
    target = (toOther[next] ?? 0) - (next - idx);
  } else {
    target = (idx / thisLen) * otherLen;
  }
  return {
    line: clamp(Math.round(target), 0, otherLen - 1),
    confidence: FALLBACK_CONFIDENCE,
    direct: false,
  };
}

/** Composes a→b and b→c into a→c (used for cards two steps away from the active one). */
export function composeLineMaps(ab: LineMap, bc: LineMap): LineMap {
  const aLength = ab.aLength;
  const cLength = bc.bLength;
  const out: LineMap = {
    aLength,
    bLength: cLength,
    aToB: new Array<number>(aLength).fill(-1),
    bToA: new Array<number>(cLength).fill(-1),
    aConfidence: new Array<number>(aLength).fill(0),
    bConfidence: new Array<number>(cLength).fill(0),
    aType: new Array<MappingTypeCode>(aLength).fill(MappingType.deleted),
    bType: new Array<MappingTypeCode>(cLength).fill(MappingType.inserted),
    overall: Math.min(ab.overall, bc.overall),
    degraded: ab.degraded || bc.degraded,
  };
  for (let i = 0; i < aLength; i++) {
    const j = ab.aToB[i] ?? -1;
    if (j < 0) {
      continue;
    }
    const k = bc.aToB[j] ?? -1;
    if (k < 0) {
      continue;
    }
    const confidence = (ab.aConfidence[i] ?? 0) * (bc.aConfidence[j] ?? 0);
    const type =
      ab.aType[i] === MappingType.unchanged && bc.aType[j] === MappingType.unchanged
        ? MappingType.unchanged
        : MappingType.modified;
    link(out, i, k, confidence, type);
  }
  return out;
}

/** Swaps the two sides of a map. */
export function invertLineMap(map: LineMap): LineMap {
  return {
    aLength: map.bLength,
    bLength: map.aLength,
    aToB: map.bToA,
    bToA: map.aToB,
    aConfidence: map.bConfidence,
    bConfidence: map.aConfidence,
    aType: map.bType,
    bType: map.aType,
    overall: map.overall,
    degraded: map.degraded,
  };
}
