import { describe, expect, it } from 'vitest';
import { diffLines } from '../../src/shared/diff/lineDiff';
import { buildLineMap } from '../../src/shared/mapping/lineMap';
import type { RevisionView } from '../../src/shared/messages/protocol';
import type { RevisionMeta } from '../../src/shared/models/revision';
import { mapLineAcross } from '../../src/webview/interaction/scrollSync';

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

/** Builds views for revisions newest-first where each view maps against the next older one. */
function buildViews(contents: string[][]): {
  revisions: RevisionMeta[];
  views: Map<string, RevisionView>;
} {
  const revisions = contents.map((_, i) => meta(`r${i}`));
  const views = new Map<string, RevisionView>();
  contents.forEach((lines, i) => {
    const view: RevisionView = {
      id: `r${i}`,
      simplified: false,
      content: { kind: 'text', id: `r${i}`, path: 'a.ts', lines, eol: 'LF', byteLength: 0 },
    };
    const older = contents[i + 1];
    if (older) {
      const diff = diffLines(older, lines);
      view.diffFromPrevious = {
        previousId: `r${i + 1}`,
        ops: diff.ops,
        deletedLines: [],
        map: buildLineMap(older, lines, diff),
      };
    }
    views.set(view.id, view);
  });
  return { revisions, views };
}

const base = Array.from({ length: 40 }, (_, i) => `line ${i}`);

describe('mapLineAcross', () => {
  it('maps through a 100-line prepend in both directions', () => {
    const newer = [...Array.from({ length: 100 }, (_, i) => `// h${i}`), ...base];
    const { revisions, views } = buildViews([newer, base]);
    expect(mapLineAcross(revisions, views, 0, 1, 120)).toEqual({
      line: 20,
      confidence: 1,
      exact: true,
    });
    expect(mapLineAcross(revisions, views, 1, 0, 20)).toEqual({
      line: 120,
      confidence: 1,
      exact: true,
    });
    expect(mapLineAcross(revisions, views, 0, 0, 5)).toEqual({
      line: 5,
      confidence: 1,
      exact: true,
    });
  });

  it('chains maps across several revisions', () => {
    const r2 = base; // oldest
    const r1 = [...base.slice(0, 10), 'inserted A', ...base.slice(10)];
    const r0 = ['top', ...r1.slice(0, 30), ...r1.slice(31)]; // prepend one, delete one
    const { revisions, views } = buildViews([r0, r1, r2]);
    // base line 35 → r1 line 36 → r0 line 36 (one prepended, one deleted before it)
    expect(mapLineAcross(revisions, views, 2, 0, 35)).toEqual({
      line: 36,
      confidence: 1,
      exact: true,
    });
    expect(mapLineAcross(revisions, views, 0, 2, 36).line).toBe(35);
    // a line inserted in r1 has no exact counterpart in r2 → interpolated, lower confidence
    const inserted = mapLineAcross(revisions, views, 1, 2, 10);
    expect(inserted.confidence).toBeLessThan(0.5);
    expect(inserted.line).toBeGreaterThanOrEqual(9);
    expect(inserted.line).toBeLessThanOrEqual(10);
  });

  it('falls back to proportional scaling when a view is missing', () => {
    const { revisions, views } = buildViews([base, base.slice(0, 20)]);
    views.delete('r0'); // no map available between r0 and r1
    views.set('r0', {
      id: 'r0',
      simplified: false,
      content: { kind: 'text', id: 'r0', path: 'a.ts', lines: base, eol: 'LF', byteLength: 0 },
    });
    const mapped = mapLineAcross(revisions, views, 0, 1, 20);
    expect(mapped.exact).toBe(false);
    expect(mapped.line).toBe(10);
    expect(mapped.confidence).toBeLessThan(0.3);
  });

  it('keeps the line when nothing is known', () => {
    const revisions = [meta('a'), meta('b')];
    const mapped = mapLineAcross(revisions, new Map(), 0, 1, 7);
    expect(mapped).toEqual({ line: 7, confidence: 0.2, exact: false });
  });
});
