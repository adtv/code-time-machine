import { describe, expect, it } from 'vitest';
import { WheelAccumulator, isTimeTravelWheel } from '../../src/webview/interaction/wheel';

describe('WheelAccumulator', () => {
  it('emits one step per mouse-wheel notch and respects the cooldown', () => {
    const acc = new WheelAccumulator({ threshold: 60, cooldownMs: 250 });
    expect(acc.feed(100, 0, 0)).toBe(1);
    expect(acc.feed(100, 0, 100)).toBe(0); // cooling down
    expect(acc.feed(-100, 0, 400)).toBe(-1);
  });

  it('accumulates small trackpad deltas and resets on direction change', () => {
    const acc = new WheelAccumulator({ threshold: 60, cooldownMs: 0 });
    expect(acc.feed(20, 0, 0)).toBe(0);
    expect(acc.feed(20, 0, 10)).toBe(0);
    expect(acc.feed(-5, 0, 20)).toBe(0); // direction change → reset
    expect(acc.feed(-30, 0, 30)).toBe(0);
    expect(acc.feed(-30, 0, 40)).toBe(-1);
  });

  it('normalises line and page delta modes', () => {
    const acc = new WheelAccumulator({ threshold: 60, cooldownMs: 0 });
    expect(acc.feed(3, 1, 0)).toBe(1); // 3 lines ≈ 60px
    expect(acc.feed(1, 2, 1)).toBe(1); // 1 page
  });
});

describe('isTimeTravelWheel', () => {
  const ev = (o: Partial<WheelEvent>) => ({
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...o,
  });
  it('matches the configured modifier only', () => {
    expect(isTimeTravelWheel(ev({ altKey: true }), 'alt')).toBe(true);
    expect(isTimeTravelWheel(ev({ altKey: true, ctrlKey: true }), 'alt')).toBe(false);
    expect(isTimeTravelWheel(ev({ ctrlKey: true }), 'ctrl')).toBe(true);
    expect(isTimeTravelWheel(ev({ metaKey: true }), 'ctrl')).toBe(true);
    expect(isTimeTravelWheel(ev({ shiftKey: true }), 'shift')).toBe(true);
    expect(isTimeTravelWheel(ev({}), 'alt')).toBe(false);
  });
});
