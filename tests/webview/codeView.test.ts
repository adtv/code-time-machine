import { describe, expect, it } from 'vitest';
import { CodeView } from '../../src/webview/rendering/codeView';
import type { RowModel } from '../../src/webview/rendering/rows';

function model(lines: number, ghostAfter?: number): RowModel {
  const rows: RowModel['rows'] = [];
  const rowOfLine: number[] = [];
  for (let i = 0; i < lines; i++) {
    if (ghostAfter !== undefined && i === ghostAfter) {
      rows.push({ kind: 'ghost', line: -1, text: 'gone' });
    }
    rowOfLine[i] = rows.length;
    rows.push({ kind: 'context', line: i, text: `line ${i}` });
  }
  return { rows, rowOfLine, lineCount: lines };
}

/** happy-dom has no layout; emulate a 200px tall viewport. */
function mount(): { el: HTMLDivElement; view: CodeView } {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientHeight', { value: 200, configurable: true });
  document.body.appendChild(el);
  const view = new CodeView(el, { rowHeight: 20, overscan: 2 });
  return { el, view };
}

describe('CodeView', () => {
  it('renders only the visible rows plus overscan and positions them by translateY', () => {
    const { el, view } = mount();
    view.setModel(model(100));
    const rows = el.querySelectorAll('.ctm-row');
    // 200px / 20px = 10 visible + 2*2 overscan (+1 inclusive) ≈ 15 rows
    expect(rows.length).toBeGreaterThanOrEqual(10);
    expect(rows.length).toBeLessThanOrEqual(16);
    const first = rows[0] as HTMLElement;
    expect(first.style.transform).toBe('translateY(0px)');
    expect(first.querySelector('.ctm-gutter')?.textContent).toBe('1');
    expect(first.querySelector('.ctm-text')?.textContent).toBe('line 0');
    view.dispose();
  });

  it('centres a line and reads it back, accounting for ghost rows', () => {
    const { el, view } = mount();
    view.setModel(model(100, 10)); // ghost row inserted before line 10 → line 10 is row 11
    view.scrollLineToCenter(50, 10);
    // row of line 50 is 51 → top = 1020; center target = 1020 + 10 → scrollTop = 1030 - 100 = 930
    expect(el.scrollTop).toBe(930);
    const center = view.centerLine();
    expect(center.line).toBe(50);
    expect(center.offset).toBe(10);
    expect(view.rowOfLine(10)).toBe(11);
    expect(view.rowOfLine(5)).toBe(5);
    view.dispose();
  });

  it('clamps to the scrollable range and skips ghost rows at the centre', () => {
    const { el, view } = mount();
    view.setModel(model(20, 5));
    view.scrollLineToCenter(19, 0);
    const max = 21 * 20 - 200;
    expect(el.scrollTop).toBe(max);
    // Put the centre exactly on the ghost row (row 5 → y 100..120): scrollTop 0 → center 100
    view.scrollLineToCenter(0, 0);
    el.scrollTop = 0;
    const center = view.centerLine();
    expect(center.line).toBeGreaterThanOrEqual(4);
    expect(center.line).toBeLessThanOrEqual(5);
    view.dispose();
  });

  it('flags approximate synchronisation', () => {
    const { el, view } = mount();
    view.setSyncConfidence(0.1, false);
    expect(el.classList.contains('ctm-code-approximate')).toBe(true);
    view.setSyncConfidence(1, true);
    expect(el.classList.contains('ctm-code-approximate')).toBe(false);
    view.dispose();
  });
});
