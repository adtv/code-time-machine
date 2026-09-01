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

/** Index of the block nearest to `centerRow` (ties → the first). */
export function nearestChangeIndex(blocks: readonly ChangeBlock[], centerRow: number): number {
  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  blocks.forEach((block, i) => {
    const distance =
      centerRow < block.startRow
        ? block.startRow - centerRow
        : centerRow > blockEnd(block)
          ? centerRow - blockEnd(block)
          : 0;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
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
  const rows = Math.max(1, block.rowCount);
  const top =
    block.startRow * view.rowHeight + (rows * view.rowHeight) / 2 - view.viewportHeight / 2;
  view.scrollTo(top);
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
    current: nearestChangeIndex(blocks, view.centerRowIndex()) + 1,
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
