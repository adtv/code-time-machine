import { diffLines } from '../../shared/diff/lineDiff';
import { buildLineMap } from '../../shared/mapping/lineMap';
import type {
  DiffFromPrevious,
  HighlightedLines,
  RevisionView,
} from '../../shared/messages/protocol';
import type { RevisionContent } from '../../shared/models/revision';

export interface ViewBuildOptions {
  ignoreWhitespace: boolean;
  maxRenderedLines: number;
}

/**
 * Builds the render-ready view of a revision: its content plus the diff and line map against
 * the previous (older) history entry. Pure and synchronous; highlighting is attached separately.
 */
export function buildRevisionView(
  current: RevisionContent,
  previous: RevisionContent | undefined,
  options: ViewBuildOptions,
  highlight?: { current?: HighlightedLines; deleted?: HighlightedLines },
): RevisionView {
  const simplified = current.kind === 'text' && current.lines.length > options.maxRenderedLines;
  const view: RevisionView = { id: current.id, content: current, simplified };
  if (highlight?.current) {
    view.highlight = highlight.current;
  }
  if (current.kind === 'text' && previous?.kind === 'text') {
    view.diffFromPrevious = buildDiffFromPrevious(
      previous.id,
      previous.lines,
      current.lines,
      options.ignoreWhitespace,
      highlight?.deleted,
    );
  }
  return view;
}

export function buildDiffFromPrevious(
  previousId: string,
  previousLines: string[],
  currentLines: string[],
  ignoreWhitespace: boolean,
  deletedHighlight?: HighlightedLines,
): DiffFromPrevious {
  const diff = diffLines(previousLines, currentLines, { ignoreWhitespace });
  const map = buildLineMap(previousLines, currentLines, diff, { ignoreWhitespace });
  const deletedLines: string[] = [];
  for (const op of diff.ops) {
    if (op.type === 'delete' || op.type === 'replace') {
      for (let i = 0; i < op.aLen; i++) {
        deletedLines.push(previousLines[op.aStart + i] ?? '');
      }
    }
  }
  const result: DiffFromPrevious = { previousId, ops: diff.ops, deletedLines, map };
  if (deletedHighlight) {
    result.deletedHighlight = deletedHighlight;
  }
  return result;
}

/** Lines removed by the diff, in order — used to highlight ghost rows. */
export function collectDeletedLines(
  previousLines: string[],
  currentLines: string[],
  ignoreWhitespace: boolean,
): string[] {
  const diff = diffLines(previousLines, currentLines, { ignoreWhitespace });
  const out: string[] = [];
  for (const op of diff.ops) {
    if (op.type === 'delete' || op.type === 'replace') {
      for (let i = 0; i < op.aLen; i++) {
        out.push(previousLines[op.aStart + i] ?? '');
      }
    }
  }
  return out;
}
