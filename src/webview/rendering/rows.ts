import type { HighlightedLines, RevisionView, Span } from '../../shared/messages/protocol';

export type RowKind = 'context' | 'added' | 'ghost';

export interface Row {
  kind: RowKind;
  /** Content line index (0-based) for context/added rows; -1 for ghost rows. */
  line: number;
  text: string;
  spans?: Span[];
  palette?: string[];
}

/** A contiguous run of changed rows (added and/or removed) — a hunk in row space. */
export interface ChangeBlock {
  /** First row of the block; for a hidden pure deletion, the row where the lines used to be. */
  startRow: number;
  /** Rows occupied in the card (0 when only hidden ghost lines). */
  rowCount: number;
  added: number;
  removed: number;
}

export interface RowModel {
  rows: Row[];
  /** Row index for each content line (so scroll sync can find where a line is rendered). */
  rowOfLine: number[];
  lineCount: number;
  /** Change blocks in row order (empty when there is no previous revision). */
  blocks: ChangeBlock[];
}

/**
 * Builds the rows of a card: the revision's lines, marking those added versus the previous
 * revision, with the previous revision's deleted lines interleaved as ghost rows at the place
 * where they used to be.
 */
export function buildRows(view: RevisionView, showGhostLines: boolean): RowModel {
  if (view.content.kind !== 'text') {
    return { rows: [], rowOfLine: [], lineCount: 0, blocks: [] };
  }
  const lines = view.content.lines;
  const palette = view.highlight?.palette;
  const spans = view.highlight?.lines;
  const rows: Row[] = [];
  const rowOfLine = new Array<number>(lines.length);
  const diff = view.diffFromPrevious;
  const blocks: ChangeBlock[] = [];
  let openBlock: ChangeBlock | undefined;

  /** Extends the current block (or opens one at the current row) with a change. */
  const noteChange = (kind: 'added' | 'removed', occupiesRow: boolean): void => {
    if (!openBlock) {
      openBlock = { startRow: rows.length, rowCount: 0, added: 0, removed: 0 };
      blocks.push(openBlock);
    }
    if (kind === 'added') {
      openBlock.added++;
    } else {
      openBlock.removed++;
    }
    if (occupiesRow) {
      openBlock.rowCount++;
    }
  };

  const pushLine = (line: number, kind: RowKind): void => {
    if (kind === 'context') {
      openBlock = undefined;
    } else {
      noteChange('added', true);
    }
    rowOfLine[line] = rows.length;
    const row: Row = { kind, line, text: lines[line] ?? '' };
    const lineSpans = spans?.[line];
    if (lineSpans && palette) {
      row.spans = lineSpans;
      row.palette = palette;
    }
    rows.push(row);
  };

  if (!diff) {
    for (let i = 0; i < lines.length; i++) {
      pushLine(i, 'context');
    }
    return { rows, rowOfLine, lineCount: lines.length, blocks: [] };
  }

  let deletedCursor = 0;
  const pushGhosts = (count: number): void => {
    for (let k = 0; k < count; k++) {
      const idx = deletedCursor++;
      noteChange('removed', showGhostLines);
      if (!showGhostLines) {
        continue;
      }
      const row: Row = { kind: 'ghost', line: -1, text: diff.deletedLines[idx] ?? '' };
      const ghostSpans = diff.deletedHighlight?.lines[idx];
      if (ghostSpans && diff.deletedHighlight) {
        row.spans = ghostSpans;
        row.palette = diff.deletedHighlight.palette;
      }
      rows.push(row);
    }
  };

  for (const op of diff.ops) {
    switch (op.type) {
      case 'equal':
        for (let i = 0; i < op.bLen; i++) {
          pushLine(op.bStart + i, 'context');
        }
        break;
      case 'insert':
        for (let i = 0; i < op.bLen; i++) {
          pushLine(op.bStart + i, 'added');
        }
        break;
      case 'delete':
        pushGhosts(op.aLen);
        break;
      case 'replace':
        pushGhosts(op.aLen);
        for (let i = 0; i < op.bLen; i++) {
          pushLine(op.bStart + i, 'added');
        }
        break;
    }
  }
  return { rows, rowOfLine, lineCount: lines.length, blocks };
}

export function highlightOf(view: RevisionView): HighlightedLines | undefined {
  return view.highlight;
}
