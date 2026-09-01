import type { Row, RowModel } from './rows';

export interface CodeViewOptions {
  /** Row height in pixels; must match the CSS. */
  rowHeight: number;
  overscan: number;
}

/**
 * Imperative, virtualised renderer for one revision's rows. Only the visible rows (plus an
 * overscan margin) exist in the DOM. Content is inserted with textContent — never innerHTML.
 */
export class CodeView {
  readonly root: HTMLElement;
  private readonly spacer: HTMLElement;
  private readonly layer: HTMLElement;
  private model: RowModel = { rows: [], rowOfLine: [], lineCount: 0 };
  private rendered = new Map<number, HTMLElement>();
  private frame = 0;
  private gutterWidth = 3;

  constructor(
    container: HTMLElement,
    private readonly options: CodeViewOptions,
  ) {
    this.root = container;
    this.root.classList.add('ctm-code');
    this.spacer = document.createElement('div');
    this.spacer.className = 'ctm-code-spacer';
    this.layer = document.createElement('div');
    this.layer.className = 'ctm-code-layer';
    this.spacer.appendChild(this.layer);
    this.root.appendChild(this.spacer);
    this.root.addEventListener('scroll', this.onScroll, { passive: true });
  }

  setModel(model: RowModel): void {
    this.model = model;
    this.gutterWidth = Math.max(3, String(model.lineCount).length);
    this.root.style.setProperty('--ctm-gutter-chars', String(this.gutterWidth));
    this.spacer.style.height = `${model.rows.length * this.options.rowHeight}px`;
    this.clear();
    this.render();
  }

  get rowHeight(): number {
    return this.options.rowHeight;
  }

  get rowCount(): number {
    return this.model.rows.length;
  }

  /** Row index of a content line (or -1). */
  rowOfLine(line: number): number {
    return this.model.rowOfLine[line] ?? -1;
  }

  /** Content line of the row rendered at the vertical centre of the viewport (or nearest). */
  centerLine(): { line: number; offset: number } {
    const centerY = this.root.scrollTop + this.root.clientHeight / 2;
    let rowIndex = Math.floor(centerY / this.options.rowHeight);
    rowIndex = Math.max(0, Math.min(this.model.rows.length - 1, rowIndex));
    // Walk to the nearest non-ghost row.
    let row = this.model.rows[rowIndex];
    let up = rowIndex;
    let down = rowIndex;
    while (row && row.line < 0 && (up > 0 || down < this.model.rows.length - 1)) {
      up = Math.max(0, up - 1);
      down = Math.min(this.model.rows.length - 1, down + 1);
      row = (this.model.rows[down]?.line ?? -1) >= 0 ? this.model.rows[down] : this.model.rows[up];
      rowIndex = row === this.model.rows[down] ? down : up;
    }
    const offset = centerY - rowIndex * this.options.rowHeight;
    return { line: row?.line ?? 0, offset };
  }

  /** Scrolls so that `line` sits `offset` pixels below the viewport centre line. */
  scrollLineToCenter(line: number, offset = this.options.rowHeight / 2): void {
    const rowIndex = this.rowOfLine(line);
    if (rowIndex < 0) {
      return;
    }
    const target = rowIndex * this.options.rowHeight + offset - this.root.clientHeight / 2;
    const max = Math.max(
      0,
      this.model.rows.length * this.options.rowHeight - this.root.clientHeight,
    );
    this.root.scrollTop = Math.max(0, Math.min(max, target));
    this.render();
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.root.removeEventListener('scroll', this.onScroll);
    this.clear();
    this.spacer.remove();
  }

  private readonly onScroll = (): void => {
    if (this.frame) {
      return;
    }
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  };

  private clear(): void {
    for (const el of this.rendered.values()) {
      el.remove();
    }
    this.rendered.clear();
  }

  render(): void {
    const { rowHeight, overscan } = this.options;
    const total = this.model.rows.length;
    const first = Math.max(0, Math.floor(this.root.scrollTop / rowHeight) - overscan);
    const visible = Math.ceil((this.root.clientHeight || 600) / rowHeight);
    const last = Math.min(total - 1, first + visible + overscan * 2);
    for (const [index, el] of this.rendered) {
      if (index < first || index > last) {
        el.remove();
        this.rendered.delete(index);
      }
    }
    for (let i = first; i <= last; i++) {
      if (this.rendered.has(i)) {
        continue;
      }
      const row = this.model.rows[i];
      if (!row) {
        continue;
      }
      const el = renderRow(row, i, rowHeight);
      this.layer.appendChild(el);
      this.rendered.set(i, el);
    }
  }
}

const KIND_LABEL: Record<Row['kind'], string> = {
  context: '',
  added: 'added line',
  ghost: 'removed line',
};

const FONT_ITALIC = 1;
const FONT_BOLD = 2;
const FONT_UNDERLINE = 4;

export function renderRow(row: Row, index: number, rowHeight: number): HTMLElement {
  const el = document.createElement('div');
  el.className = `ctm-row ctm-row-${row.kind}`;
  el.style.transform = `translateY(${index * rowHeight}px)`;
  el.setAttribute('role', 'row');
  const label = KIND_LABEL[row.kind];
  if (label) {
    el.setAttribute('aria-label', `${label}: ${row.text}`);
  }

  const gutter = document.createElement('span');
  gutter.className = 'ctm-gutter';
  gutter.textContent = row.kind === 'ghost' ? '' : String(row.line + 1);
  el.appendChild(gutter);

  const marker = document.createElement('span');
  marker.className = 'ctm-marker';
  marker.textContent = row.kind === 'added' ? '+' : row.kind === 'ghost' ? '−' : '';
  marker.setAttribute('aria-hidden', 'true');
  el.appendChild(marker);

  const text = document.createElement('span');
  text.className = 'ctm-text';
  if (row.spans && row.palette) {
    for (const [content, colorIndex, style] of row.spans) {
      const span = document.createElement('span');
      span.textContent = content;
      const color = row.palette[colorIndex];
      if (color && colorIndex !== 0) {
        span.style.color = color;
      }
      if (style) {
        if (style & FONT_ITALIC) {
          span.style.fontStyle = 'italic';
        }
        if (style & FONT_BOLD) {
          span.style.fontWeight = 'bold';
        }
        if (style & FONT_UNDERLINE) {
          span.style.textDecoration = 'underline';
        }
      }
      text.appendChild(span);
    }
  } else {
    text.textContent = row.text;
  }
  if (row.text.length === 0 && !row.spans) {
    text.textContent = ' ';
  }
  el.appendChild(text);
  return el;
}
