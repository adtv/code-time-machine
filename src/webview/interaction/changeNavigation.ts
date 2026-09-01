import { signal } from '@preact/signals';
import type { CodeView } from '../rendering/codeView';
import type { ChangeBlock } from '../rendering/rows';

export interface ChangeNavState {
  total: number;
  /** 1-based index of the change block nearest to the viewport centre (0 when none). */
  current: number;
}

/** State shown by the footer control of the active card. */
export const changeNav = signal<ChangeNavState | undefined>(undefined);

function blockEnd(block: ChangeBlock): number {
  return block.startRow + Math.max(1, block.rowCount) - 1;
}

/** Scroll target (before clamping) that centres a block in the viewport. */
function blockScrollTarget(block: ChangeBlock, rowHeight: number, viewportHeight: number): number {
  const rows = Math.max(1, block.rowCount);
  return block.startRow * rowHeight + (rows * rowHeight) / 2 - viewportHeight / 2;
}

/**
 * Index of the block the view is currently "at": the one whose clamped scroll target is closest
 * to the current scrollTop — the same maths the jumps use, so the counter always agrees with
 * them. Blocks in the first/last half viewport can never reach the centre, hence the clamping;
 * ties at the bottom edge resolve to the last block (N/N at the end of the file) and ties at the
 * top edge to the first (1/N at the start).
 */
export function currentChangeIndex(
  blocks: readonly ChangeBlock[],
  rowCount: number,
  rowHeight: number,
  viewportHeight: number,
  scrollTop: number,
): number {
  if (blocks.length === 0) {
    return -1;
  }
  const maxScroll = Math.max(0, rowCount * rowHeight - viewportHeight);
  const clamp = (value: number): number => Math.max(0, Math.min(maxScroll, value));
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  blocks.forEach((block, i) => {
    const target = clamp(blockScrollTarget(block, rowHeight, viewportHeight));
    const distance = Math.abs(scrollTop - target);
    if (distance < bestDistance - 0.5) {
      best = i;
      bestDistance = distance;
    } else if (
      distance <= bestDistance + 0.5 &&
      maxScroll > 0 &&
      target >= maxScroll - 0.5 &&
      scrollTop >= maxScroll - 0.5
    ) {
      // Only when actually resting at the bottom edge: among blocks clamped there, report the
      // last one (N/N at the end of the file). Elsewhere, ties keep the earlier block.
      best = i;
      bestDistance = Math.min(bestDistance, distance);
    }
  });
  return best;
}

/** First block starting after the centre; wraps to the first block. */
export function nextChangeIndex(blocks: readonly ChangeBlock[], centerRow: number): number {
  if (blocks.length === 0) {
    return -1;
  }
  const index = blocks.findIndex((block) => block.startRow > centerRow);
  return index >= 0 ? index : 0;
}

/** Last block ending before the centre; wraps to the last block. */
export function previousChangeIndex(blocks: readonly ChangeBlock[], centerRow: number): number {
  if (blocks.length === 0) {
    return -1;
  }
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    if (block && blockEnd(block) < centerRow) {
      return i;
    }
  }
  return blocks.length - 1;
}

/** Scroll so the block sits at the vertical centre (through the user-like scroll path → synced). */
export function scrollToBlock(view: CodeView, block: ChangeBlock): void {
  view.scrollTo(blockScrollTarget(block, view.rowHeight, view.viewportHeight));
}

export function refreshChangeNav(view: CodeView | undefined): void {
  if (!view) {
    changeNav.value = undefined;
    return;
  }
  const blocks = view.blocks;
  if (blocks.length === 0) {
    changeNav.value = { total: 0, current: 0 };
    return;
  }
  changeNav.value = {
    total: blocks.length,
    current:
      currentChangeIndex(
        blocks,
        view.rows.length,
        view.rowHeight,
        view.viewportHeight,
        view.scrollTop,
      ) + 1,
  };
}

/** Jumps to the next (+1) or previous (-1) change block of a code view. */
export function jumpToChange(view: CodeView | undefined, direction: 1 | -1): boolean {
  if (!view || view.blocks.length === 0) {
    return false;
  }
  const center = view.centerRowIndex();
  const index =
    direction > 0 ? nextChangeIndex(view.blocks, center) : previousChangeIndex(view.blocks, center);
  const block = view.blocks[index];
  if (!block) {
    return false;
  }
  scrollToBlock(view, block);
  refreshChangeNav(view);
  return true;
}

export function jumpToChangeIndex(view: CodeView | undefined, index: number): boolean {
  const block = view?.blocks[index];
  if (!view || !block) {
    return false;
  }
  scrollToBlock(view, block);
  refreshChangeNav(view);
  return true;
}
