import { describe, expect, it } from 'vitest';
import { diffLines } from '../../src/shared/diff/lineDiff';
import {
  MappingType,
  buildLineMap,
  composeLineMaps,
  dice,
  invertLineMap,
  mapLine,
  tokenize,
  type LineMap,
} from '../../src/shared/mapping/lineMap';

function build(a: string[], b: string[], ignoreWhitespace = false): LineMap {
  return buildLineMap(a, b, diffLines(a, b, { ignoreWhitespace }), { ignoreWhitespace });
}

/** Direct mappings must be strictly increasing on both sides. */
function expectMonotonic(map: LineMap): void {
  let last = -1;
  for (let i = 0; i < map.aLength; i++) {
    const j = map.aToB[i] ?? -1;
    if (j >= 0 && (map.aType[i] === MappingType.unchanged || (map.aConfidence[i] ?? 0) > 0.3)) {
      expect(j).toBeGreaterThan(last);
      last = j;
    }
  }
}

describe('LineMappingEngine fixtures', () => {
  it('A — insertion in the middle keeps A/B/C/D mapped', () => {
    const map = build(['A', 'B', 'C', 'D'], ['A', 'B', 'X', 'Y', 'C', 'D']);
    expect(map.aToB).toEqual([0, 1, 4, 5]);
    expect(map.bToA).toEqual([0, 1, -1, -1, 2, 3]);
    expect(map.bType[2]).toBe(MappingType.inserted);
    expect(map.aConfidence).toEqual([1, 1, 1, 1]);
    // An inserted line resolves to a sensible neighbour position.
    const x = mapLine(map, 'b', 2);
    expect(x.direct).toBe(false);
    expect([1, 2]).toContain(x.line);
    expect(map.overall).toBeCloseTo(4 / 6);
    expect(map.degraded).toBe(false);
  });

  it('B — deletion maps survivors and resolves deleted lines to the gap', () => {
    const map = build(['A', 'B', 'C', 'D'], ['A', 'D']);
    expect(map.aToB).toEqual([0, -1, -1, 1]);
    expect(map.aType[1]).toBe(MappingType.deleted);
    expect([0, 1]).toContain(mapLine(map, 'a', 1).line);
    expect([0, 1]).toContain(mapLine(map, 'a', 2).line);
    expect(mapLine(map, 'a', 2).direct).toBe(false);
  });

  it('C — replaced body with an unchanged signature pairs similar lines as modified', () => {
    const a = [
      'function calculateTotal(items) {',
      '  let total = 0;',
      '  for (const item of items) total += item.price;',
      '  return total;',
      '}',
    ];
    const b = [
      'function calculateTotal(items) {',
      '  let total = 0;',
      '  for (const item of items) total += item.price * item.qty;',
      '  return round(total);',
      '}',
    ];
    const map = build(a, b);
    expect(map.aType[0]).toBe(MappingType.unchanged);
    expect(map.aType[1]).toBe(MappingType.unchanged);
    expect(map.aType[4]).toBe(MappingType.unchanged);
    expect(map.aToB[2]).toBe(2);
    expect(map.aType[2]).toBe(MappingType.modified);
    expect(map.aConfidence[2] ?? 0).toBeGreaterThanOrEqual(0.6);
    expect(map.aToB[3]).toBe(3);
    expect(map.aType[3]).toBe(MappingType.modified);
    expectMonotonic(map);
  });

  it('D — 100 lines inserted at the start keep the logical lines synchronised', () => {
    const a = Array.from({ length: 40 }, (_, i) => `line ${i}`);
    const prefix = Array.from({ length: 100 }, (_, i) => `// header ${i}`);
    const b = [...prefix, ...a];
    const map = build(a, b);
    for (let i = 0; i < a.length; i++) {
      expect(map.aToB[i]).toBe(i + 100);
      expect(map.aConfidence[i]).toBe(1);
    }
    expect(mapLine(map, 'b', 120)).toEqual({ line: 20, confidence: 1, direct: true });
    expect(mapLine(map, 'b', 50).direct).toBe(false);
    expect(mapLine(map, 'b', 50).line).toBe(0);
  });

  it('E — content appended at the end leaves existing lines identical', () => {
    const a = ['a', 'b', 'c'];
    const b = ['a', 'b', 'c', 'd', 'e'];
    const map = build(a, b);
    expect(map.aToB).toEqual([0, 1, 2]);
    expect(mapLine(map, 'b', 4).line).toBe(2);
  });

  it('F — formatter (whitespace) changes still map 1:1', () => {
    const a = ['function f(a,b){', 'return a+b;', '}'];
    const b = ['function f(a, b) {', '  return a + b;', '}'];
    const strict = build(a, b);
    expect(strict.aToB).toEqual([0, 1, 2]);
    expect(strict.aType[0]).toBe(MappingType.modified);
    expect(strict.aConfidence[0]).toBe(1); // identical tokens
    const lenient = build(a, b, true);
    // Whitespace collapse alone does not equalise "a,b" vs "a, b", but tokens do.
    expect(lenient.aToB).toEqual([0, 1, 2]);
    expect(lenient.overall).toBeGreaterThan(0.9);
    expect(lenient.degraded).toBe(false);
  });

  it('G — CRLF to LF conversion does not destroy the mapping', () => {
    const a = ['a\r', 'b\r', 'c\r', 'd\r'];
    const b = ['a', 'b', 'NEW', 'c', 'd'];
    const map = build(a, b);
    expect(map.aToB).toEqual([0, 1, 3, 4]);
    expect(map.aType).toEqual([0, 0, 0, 0]);
  });

  it('H — a rewritten file degrades gracefully without inventing correspondences', () => {
    const a = Array.from({ length: 12 }, (_, i) => `alpha beta gamma ${i}`);
    const b = Array.from({ length: 15 }, (_, i) => `omega psi chi ${i + 100}`);
    const map = build(a, b);
    expect(map.degraded).toBe(true);
    expect(map.overall).toBeLessThan(0.15);
    for (let i = 0; i < a.length; i++) {
      expect(map.aConfidence[i] ?? 0).toBeLessThanOrEqual(0.3);
      expect(map.aType[i]).toBe(MappingType.modified);
    }
    // Fallback is proportional and always in range.
    const first = mapLine(map, 'a', 0);
    const last = mapLine(map, 'a', 11);
    expect(first.line).toBeLessThanOrEqual(last.line);
    expect(last.line).toBeLessThan(15);
    expect(first.confidence).toBeLessThanOrEqual(0.3);
  });

  it('moved block — untouched lines map exactly, moved lines are not fabricated', () => {
    const helper = ['function helper() {', '  return 42;', '}'];
    const main = ['export function main() {', '  return helper();', '}'];
    const a = [...helper, '', ...main];
    const b = [...main, '', ...helper];
    const map = build(a, b);
    // Patience keeps one of the two blocks (2 unique anchors) plus its closing brace as exact
    // matches; the moved block becomes delete + insert and must not be paired arbitrarily.
    const exactA = map.aType.filter((t) => t === MappingType.unchanged).length;
    expect(exactA).toBeGreaterThanOrEqual(3);
    expect(map.aType.filter((t) => t === MappingType.deleted).length).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < a.length; i++) {
      const j = map.aToB[i] ?? -1;
      if (j >= 0 && map.aType[i] === MappingType.unchanged) {
        expect(b[j]).toBe(a[i]);
      }
    }
    expectMonotonic(map);
  });

  it('mapLine clamps out-of-range input and handles empty sides', () => {
    const map = build(['a', 'b'], ['a', 'b', 'c']);
    expect(mapLine(map, 'a', 99).line).toBe(1);
    expect(mapLine(map, 'a', -5).line).toBe(0);
    const empty = build([], ['a']);
    expect(mapLine(empty, 'b', 0)).toEqual({ line: 0, confidence: 0, direct: false });
    expect(mapLine(empty, 'a', 0)).toEqual({ line: 0, confidence: 0, direct: false });
    expect(build([], []).overall).toBe(1);
  });
});

describe('composeLineMaps / invertLineMap', () => {
  it('composes a→b→c through insertions and deletions', () => {
    const a = ['A', 'B', 'C', 'D'];
    const b = ['A', 'X', 'B', 'C', 'D'];
    const c = ['A', 'X', 'B', 'D', 'E'];
    const ab = build(a, b);
    const bc = build(b, c);
    const ac = composeLineMaps(ab, bc);
    expect(ac.aLength).toBe(4);
    expect(ac.bLength).toBe(5);
    expect(ac.aToB).toEqual([0, 2, -1, 3]);
    expect(ac.bToA).toEqual([0, -1, 1, 3, -1]);
    expect(ac.aType[2]).toBe(MappingType.deleted);
    expect(ac.bType[4]).toBe(MappingType.inserted);
    expect(ac.aConfidence[1]).toBe(1);
    expect(ac.degraded).toBe(false);
  });

  it('inverts sides', () => {
    const map = build(['A', 'B'], ['B']);
    const inv = invertLineMap(map);
    expect(inv.aLength).toBe(1);
    expect(inv.aToB).toEqual([1]);
    expect(inv.bToA).toEqual([-1, 0]);
    expect(inv.aType[0]).toBe(MappingType.unchanged);
  });
});

describe('tokenize / dice', () => {
  it('tokenizes identifiers and numbers, ignoring punctuation', () => {
    expect([...tokenize('const total = items.reduce((s, i) => s + i.price, 0);')]).toEqual([
      'const',
      'total',
      'items',
      'reduce',
      's',
      'i',
      'price',
      '0',
    ]);
    expect([...tokenize('héllo_wörld 42')]).toEqual(['héllo_wörld', '42']);
  });

  it('computes Dice similarity with blank-line handling', () => {
    expect(dice(new Set(['a', 'b']), new Set(['a', 'b']))).toBe(1);
    expect(dice(new Set(['a', 'b']), new Set(['b', 'c']))).toBeCloseTo(0.5);
    expect(dice(new Set(), new Set())).toBe(1);
    expect(dice(new Set(['a']), new Set())).toBe(0);
  });
});
