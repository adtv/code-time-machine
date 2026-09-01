import { useEffect, useRef } from 'preact/hooks';
import { installWheelTimeTravel } from '../interaction/wheel';
import { activeIndex, config, errors, navigate, revisions, setActive, views } from '../state/store';
import { RevisionCard } from './RevisionCard';

/** Cards rendered around the active one: newer above, older below. */
export const DECK_NEWER = 1;
export const DECK_OLDER = 2;

/**
 * The layered deck. Cards are keyed by revision id so the same DOM node (and its scroll
 * position) travels between depth slots, letting CSS transitions animate the time travel.
 * Newer revisions stack above the active card, older ones below; one extra card on each side
 * is rendered invisible so entering/leaving cards fade instead of popping.
 */
export function RevisionDeck() {
  const list = revisions.value;
  const active = activeIndex.value;
  const loaded = views.value;
  const failed = errors.value;
  const deckRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = deckRef.current;
    if (!el) {
      return;
    }
    return installWheelTimeTravel(el, {
      modifier: () => config.value.timeTravelModifier,
      cooldownMs: () => config.value.animationDuration + 60,
      onStep: (step) => navigate(step),
    });
  }, []);

  const cards = [];
  for (let i = active - DECK_NEWER - 1; i <= active + DECK_OLDER + 1; i++) {
    const revision = list[i];
    if (!revision) {
      continue;
    }
    cards.push(
      <RevisionCard
        key={revision.id}
        revision={revision}
        view={loaded.get(revision.id)}
        error={failed.get(revision.id)}
        offset={i - active}
        onActivate={() => setActive(i)}
      />,
    );
  }
  return (
    <div
      class="ctm-deck"
      ref={deckRef}
      style={{ '--ctm-anim-duration': `${config.value.animationDuration}ms` }}
      role="region"
      aria-label="Revision deck"
    >
      {cards}
    </div>
  );
}

/** Depth slot for an offset: 'hidden' beyond the visible range. */
export function slotFor(offset: number): string {
  if (offset < -DECK_NEWER) {
    return 'hidden-newer';
  }
  if (offset > DECK_OLDER) {
    return 'hidden-older';
  }
  return String(offset);
}
