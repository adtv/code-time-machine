import { mapLine } from '../../shared/mapping/lineMap';
import type { RevisionView } from '../../shared/messages/protocol';
import type { RevisionMeta } from '../../shared/models/revision';
import { getCodeView } from '../rendering/registry';

export interface MappedPosition {
  line: number;
  /** Product of the confidences along the mapping chain (1 = exact). */
  confidence: number;
  /** False when a proportional fallback was used somewhere in the chain. */
  exact: boolean;
}

function lineCount(view: RevisionView | undefined): number | undefined {
  return view?.content.kind === 'text' ? view.content.lines.length : undefined;
}

/**
 * Maps a content line of revision `fromIndex` to the corresponding line of revision `toIndex`
 * by walking the chain of adjacent line maps (each RevisionView carries the map between itself
 * and the next older revision). Missing maps fall back to proportional scaling.
 */
export function mapLineAcross(
  revisions: readonly RevisionMeta[],
  views: ReadonlyMap<string, RevisionView>,
  fromIndex: number,
  toIndex: number,
  line: number,
): MappedPosition {
  let current = line;
  let confidence = 1;
  let exact = true;
  if (fromIndex === toIndex) {
    return { line, confidence, exact };
  }
  const step = toIndex > fromIndex ? 1 : -1;
  for (let k = fromIndex; k !== toIndex; k += step) {
    // Moving older (k → k+1): the newer revision's view maps prev(a = k+1) ↔ cur(b = k).
    // Moving newer (k → k-1): the newer revision (k-1) holds the map prev(a = k) ↔ cur(b = k-1).
    const newerIndex = step > 0 ? k : k - 1;
    const olderIndex = newerIndex + 1;
    const newerId = revisions[newerIndex]?.id;
    const newerView = newerId !== undefined ? views.get(newerId) : undefined;
    const map = newerView?.diffFromPrevious?.map;
    if (map && newerView?.diffFromPrevious?.previousId === revisions[olderIndex]?.id) {
      const mapped = step > 0 ? mapLine(map, 'b', current) : mapLine(map, 'a', current);
      current = mapped.line;
      confidence *= mapped.confidence;
      if (map.degraded) {
        exact = false;
      }
      continue;
    }
    // Fallback: proportional between the two revisions' line counts when known.
    const fromLen = lineCount(views.get(revisions[k]?.id ?? ''));
    const toLen = lineCount(views.get(revisions[k + step]?.id ?? ''));
    if (fromLen && toLen && fromLen > 0) {
      current = Math.round((current / fromLen) * toLen);
    }
    exact = false;
    confidence *= 0.2;
  }
  return { line: Math.max(0, current), confidence, exact };
}

export interface Anchor {
  index: number;
  line: number;
  /** Pixel offset of the anchor line relative to the viewport centre line (see CodeView). */
  offset: number;
}

export interface SyncState {
  revisions: readonly RevisionMeta[];
  views: ReadonlyMap<string, RevisionView>;
  activeIndex: number;
}

/**
 * Keeps every visible card centred on the same *logical* region as the active card.
 *
 * The controller remembers an anchor (revision index + content line at the viewport centre).
 * The anchor follows the user's scrolling in the active card; when the active revision changes
 * the anchor is re-expressed in the new revision through the line maps, so the newly active
 * card does not jump and its neighbours follow.
 */
export class ScrollSyncController {
  private anchor: Anchor | undefined;
  private frame = 0;
  private readonly indicesAround: number[];

  constructor(
    private readonly state: () => SyncState,
    options: { newer: number; older: number } = { newer: 1, older: 2 },
  ) {
    this.indicesAround = [];
    for (let d = -options.newer; d <= options.older; d++) {
      this.indicesAround.push(d);
    }
  }

  get currentAnchor(): Anchor | undefined {
    return this.anchor;
  }

  /** The active card was scrolled by the user. */
  onActiveScrolled(): void {
    const { revisions, activeIndex } = this.state();
    const active = revisions[activeIndex];
    const view = active ? getCodeView(active.id) : undefined;
    if (!view) {
      return;
    }
    const center = view.centerLine();
    this.anchor = { index: activeIndex, line: center.line, offset: center.offset };
    this.scheduleSync();
  }

  /** A card's content became available (or it was re-mounted): align it with the anchor. */
  onCardReady(id: string): void {
    const { revisions, activeIndex } = this.state();
    const index = revisions.findIndex((r) => r.id === id);
    if (index < 0) {
      return;
    }
    if (!this.anchor) {
      // Nothing scrolled yet: everything aligns at the top of the active revision.
      this.anchor = { index: activeIndex, line: 0, offset: 0 };
      if (index === activeIndex) {
        return;
      }
    }
    if (index === activeIndex && this.anchor.index !== activeIndex) {
      this.reanchorTo(activeIndex);
      this.scheduleSync();
      return;
    }
    this.syncCard(index);
  }

  /** The active revision changed: re-express the anchor in the new revision. */
  onActiveChanged(): void {
    const { activeIndex } = this.state();
    if (!this.anchor) {
      return;
    }
    if (this.anchor.index !== activeIndex) {
      this.reanchorTo(activeIndex);
    }
    this.scheduleSync();
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
  }

  private reanchorTo(index: number): void {
    const { revisions, views } = this.state();
    if (!this.anchor) {
      return;
    }
    const target = revisions[index];
    const view = target ? getCodeView(target.id) : undefined;
    if (!view) {
      return; // keep the old anchor until the new active card is loaded
    }
    const mapped = mapLineAcross(revisions, views, this.anchor.index, index, this.anchor.line);
    view.scrollLineToCenter(mapped.line, this.anchor.offset);
    this.anchor = { index, line: mapped.line, offset: this.anchor.offset };
  }

  private scheduleSync(): void {
    if (this.frame) {
      return;
    }
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.syncAll();
    });
  }

  private syncAll(): void {
    const { activeIndex } = this.state();
    for (const delta of this.indicesAround) {
      if (delta !== 0) {
        this.syncCard(activeIndex + delta);
      }
    }
  }

  private syncCard(index: number): void {
    const { revisions, views } = this.state();
    const anchor = this.anchor;
    const meta = revisions[index];
    if (!anchor || !meta || index === anchor.index) {
      return;
    }
    const view = getCodeView(meta.id);
    if (!view) {
      return;
    }
    const mapped = mapLineAcross(revisions, views, anchor.index, index, anchor.line);
    view.scrollLineToCenter(mapped.line, anchor.offset);
    view.setSyncConfidence(mapped.confidence, mapped.exact);
  }
}
