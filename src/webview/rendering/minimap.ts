import type { CodeView } from './codeView';
import type { Row, RowModel } from './rows';

/** Geometry of the minimap for the current viewport (pure, unit-tested). */
export interface MinimapLayout {
  /** Height of one row in minimap pixels (1–3). */
  miniRow: number;
  /** Total minimap height of the whole file. */
  miniContentHeight: number;
  /** Offset of the minimap's own scroll when the file does not fit. */
  miniScroll: number;
  sliderTop: number;
  sliderHeight: number;
  canvasHeight: number;
  /** True when the minimap content is taller than the canvas and scrolls with the code. */
  scrollable: boolean;
}

export const MAX_MINI_ROW = 3;

export function computeMinimapLayout(
  rowCount: number,
  rowHeight: number,
  scrollTop: number,
  clientHeight: number,
  canvasHeight: number,
): MinimapLayout {
  const rows = Math.max(1, rowCount);
  const miniRow = Math.max(1, Math.min(MAX_MINI_ROW, Math.floor(canvasHeight / rows)));
  const miniContentHeight = rows * miniRow;
  const scrollable = miniContentHeight > canvasHeight;
  const maxScroll = Math.max(0, rows * rowHeight - clientHeight);
  const ratio = maxScroll > 0 ? Math.min(1, Math.max(0, scrollTop / maxScroll)) : 0;
  const miniScroll = scrollable ? (miniContentHeight - canvasHeight) * ratio : 0;
  const visibleRows = rowHeight > 0 ? clientHeight / rowHeight : rows;
  const sliderHeight = Math.min(canvasHeight, Math.max(6, visibleRows * miniRow));
  const sliderTop = Math.max(
    0,
    Math.min(canvasHeight - sliderHeight, (scrollTop / rowHeight) * miniRow - miniScroll),
  );
  return {
    miniRow,
    miniContentHeight,
    miniScroll,
    sliderTop,
    sliderHeight,
    canvasHeight,
    scrollable,
  };
}

/** Row under a y coordinate of the canvas. */
export function rowAtMinimapY(layout: MinimapLayout, y: number, rowCount: number): number {
  const row = Math.floor((y + layout.miniScroll) / layout.miniRow);
  return Math.max(0, Math.min(Math.max(0, rowCount - 1), row));
}

/** Code scrollTop that puts the slider at `sliderTop` (used while dragging). */
export function scrollTopForSliderTop(
  layout: MinimapLayout,
  sliderTop: number,
  rowCount: number,
  rowHeight: number,
  clientHeight: number,
): number {
  const maxScroll = Math.max(0, rowCount * rowHeight - clientHeight);
  const track = Math.max(1, layout.canvasHeight - layout.sliderHeight);
  const clampedTop = Math.max(0, Math.min(track, sliderTop));
  if (layout.scrollable) {
    return (clampedTop / track) * maxScroll;
  }
  return Math.max(0, Math.min(maxScroll, (clampedTop / layout.miniRow) * rowHeight));
}

export interface MinimapColors {
  foreground: string;
  added: string;
  removed: string;
  addedMarker: string;
  removedMarker: string;
  slider: string;
  sliderHover: string;
  sliderActive: string;
}

const STATIC_LAYER_MAX_HEIGHT = 16_384;
const TAB_COLUMNS = 4;
/** Solid change marker at the left edge of the minimap (like the editor's minimap gutter). */
const MARKER_WIDTH = 4;
const TEXT_OFFSET = MARKER_WIDTH + 2;

/**
 * Canvas minimap for one CodeView: a scaled-down picture of the rows (token colours, added and
 * ghost rows tinted) with a slider for the visible region. The picture is pre-rendered to a static
 * layer once per model/size/theme; scrolling only re-composites it, so it is cheap.
 */
export class Minimap {
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly staticLayer = document.createElement('canvas');
  private model: RowModel = { rows: [], rowOfLine: [], lineCount: 0, blocks: [] };
  private layout: MinimapLayout | undefined;
  private cssWidth = 0;
  private cssHeight = 0;
  private dpr = 1;
  private frame = 0;
  private state: 'idle' | 'hover' | 'active' = 'idle';
  private dragOffset = 0;
  private colors: MinimapColors;
  private readonly unsubscribe: () => void;
  private observer: ResizeObserver | undefined;
  private disposed = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly view: CodeView,
    private readonly readColors: () => MinimapColors,
  ) {
    this.ctx = canvas.getContext('2d');
    this.colors = readColors();
    canvas.classList.add('ctm-minimap');
    canvas.setAttribute('aria-hidden', 'true');
    this.unsubscribe = view.subscribeScroll(() => this.scheduleRender());
    canvas.addEventListener('mousedown', this.onMouseDown);
    canvas.addEventListener('mouseenter', this.onMouseEnter);
    canvas.addEventListener('mouseleave', this.onMouseLeave);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => this.resize());
      this.observer.observe(canvas);
    }
    this.resize();
  }

  setModel(model: RowModel): void {
    this.model = model;
    this.rebuildStatic();
    this.scheduleRender();
  }

  refreshTheme(): void {
    this.colors = this.readColors();
    this.rebuildStatic();
    this.scheduleRender();
  }

  get currentLayout(): MinimapLayout | undefined {
    return this.layout;
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.unsubscribe();
    this.observer?.disconnect();
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    this.canvas.removeEventListener('mouseenter', this.onMouseEnter);
    this.canvas.removeEventListener('mouseleave', this.onMouseLeave);
    this.canvas.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mouseup', this.onMouseUp);
  }

  // -------------------------------------------------------------------------------------------

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width || this.canvas.clientWidth || 72));
    const height = Math.max(1, Math.round(rect.height || this.canvas.clientHeight || 0));
    const dpr = window.devicePixelRatio || 1;
    if (width === this.cssWidth && height === this.cssHeight && dpr === this.dpr) {
      return;
    }
    this.cssWidth = width;
    this.cssHeight = height;
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.rebuildStatic();
    this.scheduleRender();
  }

  private computeLayout(): MinimapLayout {
    return computeMinimapLayout(
      this.model.rows.length,
      this.view.rowHeight,
      this.view.scrollTop,
      this.view.viewportHeight,
      this.cssHeight,
    );
  }

  /** Draws every row once into the static layer. */
  private rebuildStatic(): void {
    if (!this.ctx || this.cssHeight === 0) {
      return;
    }
    const layout = this.computeLayout();
    const height = Math.min(STATIC_LAYER_MAX_HEIGHT, Math.max(1, layout.miniContentHeight));
    this.staticLayer.width = Math.round(this.cssWidth * this.dpr);
    this.staticLayer.height = Math.round(height * this.dpr);
    const ctx = this.staticLayer.getContext('2d');
    if (!ctx) {
      return;
    }
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.cssWidth, height);
    const rows = this.model.rows;
    const maxRows = Math.floor(height / layout.miniRow);
    for (let i = 0; i < rows.length && i < maxRows; i++) {
      const row = rows[i];
      if (!row) {
        continue;
      }
      const y = i * layout.miniRow;
      if (row.kind === 'added' || row.kind === 'ghost') {
        const tint = row.kind === 'added' ? this.colors.added : this.colors.removed;
        const marker = row.kind === 'added' ? this.colors.addedMarker : this.colors.removedMarker;
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = tint;
        ctx.fillRect(TEXT_OFFSET - 1, y, this.cssWidth - TEXT_OFFSET + 1, layout.miniRow);
        ctx.globalAlpha = 1;
        ctx.fillStyle = marker;
        ctx.fillRect(0, y, MARKER_WIDTH, layout.miniRow);
      }
      this.drawRowText(ctx, row, y, Math.max(1, layout.miniRow - (layout.miniRow > 1 ? 1 : 0)));
    }
    // Pure deletions whose ghost rows are hidden still deserve a mark where the lines were.
    for (const block of this.model.blocks) {
      if (block.rowCount === 0 && block.removed > 0) {
        const y = Math.min(height - 2, block.startRow * layout.miniRow);
        ctx.globalAlpha = 0.95;
        ctx.fillStyle = this.colors.removedMarker;
        ctx.fillRect(0, Math.max(0, y - 1), this.cssWidth, 2);
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawRowText(ctx: CanvasRenderingContext2D, row: Row, y: number, h: number): void {
    const maxCols = this.cssWidth - TEXT_OFFSET;
    let col = 0;
    const ghost = row.kind === 'ghost';
    const x0 = TEXT_OFFSET;
    const drawRuns = (text: string, color: string): boolean => {
      ctx.fillStyle = color;
      let runStart = -1;
      for (let i = 0; i < text.length; i++) {
        const ch = text.charCodeAt(i);
        if (ch === 32 || ch === 9) {
          if (runStart >= 0) {
            ctx.fillRect(x0 + runStart, y, col - runStart, h);
            runStart = -1;
          }
          col += ch === 9 ? TAB_COLUMNS : 1;
        } else {
          if (runStart < 0) {
            runStart = col;
          }
          col++;
        }
        if (col >= maxCols) {
          if (runStart >= 0) {
            ctx.fillRect(x0 + runStart, y, maxCols - runStart, h);
          }
          return false;
        }
      }
      if (runStart >= 0) {
        ctx.fillRect(x0 + runStart, y, col - runStart, h);
      }
      return true;
    };
    ctx.globalAlpha = ghost ? 0.45 : 0.75;
    if (row.spans && row.palette) {
      for (const [text, colorIndex] of row.spans) {
        const color = ghost
          ? this.colors.removed
          : (row.palette[colorIndex] ?? this.colors.foreground);
        if (!drawRuns(text, color)) {
          break;
        }
      }
    } else {
      drawRuns(row.text, ghost ? this.colors.removed : this.colors.foreground);
    }
  }

  private scheduleRender(): void {
    if (this.frame || this.disposed) {
      return;
    }
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  private render(): void {
    const ctx = this.ctx;
    if (!ctx || this.cssHeight === 0) {
      return;
    }
    const layout = this.computeLayout();
    this.layout = layout;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.cssWidth, this.cssHeight);
    if (this.staticLayer.height > 0) {
      const sy = layout.miniScroll * this.dpr;
      const sh = Math.min(this.staticLayer.height - sy, this.cssHeight * this.dpr);
      if (sh > 0) {
        ctx.drawImage(
          this.staticLayer,
          0,
          sy,
          this.staticLayer.width,
          sh,
          0,
          0,
          this.cssWidth,
          sh / this.dpr,
        );
      }
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle =
      this.state === 'active'
        ? this.colors.sliderActive
        : this.state === 'hover'
          ? this.colors.sliderHover
          : this.colors.slider;
    ctx.fillRect(0, layout.sliderTop, this.cssWidth, layout.sliderHeight);
  }

  private readonly onMouseEnter = (): void => {
    if (this.state !== 'active') {
      this.state = 'hover';
      this.scheduleRender();
    }
  };

  private readonly onMouseLeave = (): void => {
    if (this.state !== 'active') {
      this.state = 'idle';
      this.scheduleRender();
    }
  };

  private readonly onWheel = (event: WheelEvent): void => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return; // leave modifier+wheel (time travel) to the deck
    }
    event.preventDefault();
    const delta = event.deltaMode === 1 ? event.deltaY * this.view.rowHeight : event.deltaY;
    this.view.scrollTo(this.view.scrollTop + delta);
  };

  private readonly onMouseDown = (event: MouseEvent): void => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    const layout = this.computeLayout();
    const y = event.clientY - this.canvas.getBoundingClientRect().top;
    const inSlider = y >= layout.sliderTop && y <= layout.sliderTop + layout.sliderHeight;
    if (!inSlider) {
      // Jump so the clicked row is centred, then continue as a drag from the slider centre.
      const row = rowAtMinimapY(layout, y, this.model.rows.length);
      this.view.scrollTo(
        row * this.view.rowHeight + this.view.rowHeight / 2 - this.view.viewportHeight / 2,
      );
      this.dragOffset = layout.sliderHeight / 2;
    } else {
      this.dragOffset = y - layout.sliderTop;
    }
    this.state = 'active';
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mouseup', this.onMouseUp);
    this.scheduleRender();
  };

  private readonly onMouseMove = (event: MouseEvent): void => {
    const layout = this.computeLayout();
    const y = event.clientY - this.canvas.getBoundingClientRect().top;
    const target = scrollTopForSliderTop(
      layout,
      y - this.dragOffset,
      this.model.rows.length,
      this.view.rowHeight,
      this.view.viewportHeight,
    );
    this.view.scrollTo(target);
  };

  private readonly onMouseUp = (): void => {
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mouseup', this.onMouseUp);
    this.state = 'idle';
    this.scheduleRender();
  };
}

/** Reads the minimap colours from the theme variables available on `element`. */
export function readMinimapColors(element: Element): MinimapColors {
  const style = getComputedStyle(element);
  const read = (name: string, fallback: string): string => {
    const value = style.getPropertyValue(name).trim();
    return value.length > 0 ? value : fallback;
  };
  return {
    foreground: read('--vscode-editor-foreground', '#cccccc'),
    added: read('--ctm-added-fg', '#81b88b'),
    removed: read('--ctm-removed-fg', '#c74e39'),
    addedMarker: read('--vscode-minimapGutter-addedBackground', read('--ctm-added-fg', '#81b88b')),
    removedMarker: read(
      '--vscode-minimapGutter-deletedBackground',
      read('--ctm-removed-fg', '#c74e39'),
    ),
    slider: read('--vscode-minimapSlider-background', 'rgba(121, 121, 121, 0.2)'),
    sliderHover: read('--vscode-minimapSlider-hoverBackground', 'rgba(100, 100, 100, 0.35)'),
    sliderActive: read('--vscode-minimapSlider-activeBackground', 'rgba(191, 191, 191, 0.4)'),
  };
}
