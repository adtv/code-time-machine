import type { TimeTravelModifier } from '../../shared/messages/protocol';

export interface WheelAccumulatorOptions {
  /** Accumulated (normalised) delta required for one step. */
  threshold: number;
  /** Ignore input for this long after a step (absorbs trackpad inertia during the animation). */
  cooldownMs: number;
}

/**
 * Turns a stream of wheel deltas into discrete ±1 steps. Mouse wheels emit ~100px per notch,
 * trackpads emit many small deltas; both reach the threshold naturally.
 */
export class WheelAccumulator {
  private accumulated = 0;
  private lastStepAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly options: WheelAccumulatorOptions) {}

  /** @param deltaMode 0 = pixels, 1 = lines, 2 = pages (WheelEvent.deltaMode). */
  feed(deltaY: number, deltaMode: number, now: number): -1 | 0 | 1 {
    const normalised = deltaMode === 1 ? deltaY * 20 : deltaMode === 2 ? deltaY * 400 : deltaY;
    if (now - this.lastStepAt < this.options.cooldownMs) {
      this.accumulated = 0;
      return 0;
    }
    if (Math.sign(normalised) !== Math.sign(this.accumulated)) {
      this.accumulated = 0;
    }
    this.accumulated += normalised;
    if (Math.abs(this.accumulated) >= this.options.threshold) {
      const step = this.accumulated > 0 ? 1 : -1;
      this.accumulated = 0;
      this.lastStepAt = now;
      return step;
    }
    return 0;
  }

  reset(): void {
    this.accumulated = 0;
  }
}

export function isTimeTravelWheel(
  event: Pick<WheelEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>,
  modifier: TimeTravelModifier,
): boolean {
  switch (modifier) {
    case 'alt':
      return event.altKey && !event.ctrlKey && !event.metaKey;
    case 'ctrl':
      return (event.ctrlKey || event.metaKey) && !event.altKey;
    case 'shift':
      return event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey;
  }
}

export interface WheelTimeTravelOptions {
  modifier: () => TimeTravelModifier;
  cooldownMs: () => number;
  /** Positive = older. */
  onStep: (step: 1 | -1) => void;
  threshold?: number;
}

/** Installs modifier+wheel time travel on an element. Plain wheel events are left untouched. */
export function installWheelTimeTravel(
  element: HTMLElement,
  options: WheelTimeTravelOptions,
): () => void {
  const accumulator = new WheelAccumulator({
    threshold: options.threshold ?? 60,
    cooldownMs: options.cooldownMs(),
  });
  let lastCooldown = options.cooldownMs();
  const listener = (event: WheelEvent): void => {
    if (!isTimeTravelWheel(event, options.modifier())) {
      return;
    }
    event.preventDefault();
    const cooldown = options.cooldownMs();
    if (cooldown !== lastCooldown) {
      lastCooldown = cooldown;
    }
    const step = accumulator.feed(event.deltaY, event.deltaMode, performance.now());
    if (step !== 0) {
      options.onStep(step);
    }
  };
  element.addEventListener('wheel', listener, { passive: false });
  return () => element.removeEventListener('wheel', listener);
}
