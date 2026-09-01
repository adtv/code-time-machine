import { effect } from '@preact/signals';
import { activeIndex, revisions, views } from '../state/store';
import { ScrollSyncController } from './scrollSync';

/** Single controller for the deck, fed by the store. */
export const scrollSync = new ScrollSyncController(() => ({
  revisions: revisions.value,
  views: views.value,
  activeIndex: activeIndex.value,
}));

let installed = false;

/** Re-anchors whenever the active revision changes. */
export function installScrollSync(): void {
  if (installed) {
    return;
  }
  installed = true;
  let last = activeIndex.value;
  effect(() => {
    const current = activeIndex.value;
    if (current !== last) {
      last = current;
      scrollSync.onActiveChanged();
    }
  });
}
