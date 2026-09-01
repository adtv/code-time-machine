import { describe, expect, it } from 'vitest';
import {
  computeMinimapLayout,
  rowAtMinimapY,
  scrollTopForSliderTop,
} from '../../src/webview/rendering/minimap';

describe('minimap layout', () => {
  it('fits a short file with 3px rows and a proportional slider', () => {
    // 100 rows × 20px, viewport 400px (20 rows visible), canvas 600px.
    const layout = computeMinimapLayout(100, 20, 0, 400, 600);
    expect(layout.miniRow).toBe(3);
    expect(layout.miniContentHeight).toBe(300);
    expect(layout.scrollable).toBe(false);
    expect(layout.miniScroll).toBe(0);
    expect(layout.sliderTop).toBe(0);
    expect(layout.sliderHeight).toBe(60); // 20 visible rows × 3px
    const scrolled = computeMinimapLayout(100, 20, 200, 400, 600); // 10 rows down
    expect(scrolled.sliderTop).toBe(30);
    expect(rowAtMinimapY(scrolled, 45, 100)).toBe(15);
  });

  it('scrolls the minimap itself for tall files and keeps the slider inside the canvas', () => {
    // 5000 rows × 20px, viewport 500px, canvas 600px → 1px rows, content 5000px.
    const top = computeMinimapLayout(5000, 20, 0, 500, 600);
    expect(top.miniRow).toBe(1);
    expect(top.scrollable).toBe(true);
    expect(top.miniScroll).toBe(0);
    expect(top.sliderHeight).toBe(25);
    const maxScroll = 5000 * 20 - 500;
    const bottom = computeMinimapLayout(5000, 20, maxScroll, 500, 600);
    expect(bottom.miniScroll).toBe(5000 - 600);
    expect(bottom.sliderTop + bottom.sliderHeight).toBeCloseTo(600, 5);
    const middle = computeMinimapLayout(5000, 20, maxScroll / 2, 500, 600);
    expect(middle.sliderTop).toBeGreaterThan(200);
    expect(middle.sliderTop).toBeLessThan(400);
    expect(rowAtMinimapY(middle, 0, 5000)).toBe(Math.floor(middle.miniScroll));
  });

  it('maps a dragged slider position back to a scrollTop (both regimes)', () => {
    const short = computeMinimapLayout(100, 20, 0, 400, 600);
    expect(scrollTopForSliderTop(short, 30, 100, 20, 400)).toBe(200);
    expect(scrollTopForSliderTop(short, -50, 100, 20, 400)).toBe(0);
    expect(scrollTopForSliderTop(short, 10_000, 100, 20, 400)).toBe(100 * 20 - 400);
    const tall = computeMinimapLayout(5000, 20, 0, 500, 600);
    const maxScroll = 5000 * 20 - 500;
    expect(scrollTopForSliderTop(tall, 0, 5000, 20, 500)).toBe(0);
    expect(scrollTopForSliderTop(tall, 600 - tall.sliderHeight, 5000, 20, 500)).toBeCloseTo(
      maxScroll,
      5,
    );
  });

  it('handles empty models', () => {
    const layout = computeMinimapLayout(0, 20, 0, 400, 600);
    expect(layout.miniRow).toBe(3);
    expect(rowAtMinimapY(layout, 100, 0)).toBe(0);
    expect(scrollTopForSliderTop(layout, 50, 0, 20, 400)).toBe(0);
  });
});
