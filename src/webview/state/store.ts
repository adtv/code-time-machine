import { computed, signal } from '@preact/signals';
import type {
  EmptyState,
  ExtensionToWebview,
  InitPayload,
  RevisionView,
  ThemeKind,
  WebviewConfig,
} from '../../shared/messages/protocol';
import type { RevisionMeta } from '../../shared/models/revision';
import { getPersistedState, persistState, postToExtension } from './messaging';

export const init = signal<InitPayload | undefined>(undefined);
export const revisions = signal<RevisionMeta[]>([]);
export const hasMore = signal(false);
export const loadingMore = signal(false);
export const activeIndex = signal(0);
export const views = signal<ReadonlyMap<string, RevisionView>>(new Map());
export const errors = signal<ReadonlyMap<string, string>>(new Map());
export const empty = signal<EmptyState | undefined>(undefined);
export const busy = signal<{ busy: boolean; message?: string }>({ busy: true });
export const config = signal<WebviewConfig>({
  animationDuration: 200,
  showGhostLines: true,
  showMinimap: true,
  timeTravelModifier: 'alt',
  preloadRevisions: 3,
  maxRenderedLines: 8000,
});
export const theme = signal<ThemeKind>('dark');
export const timelineVisible = signal<boolean>(getPersistedState().timelineVisible ?? true);
/** Local override of config.showGhostLines (toolbar toggle); undefined = follow the setting. */
export const ghostOverride = signal<boolean | undefined>(undefined);
export const showGhostLines = computed(() => ghostOverride.value ?? config.value.showGhostLines);

export function toggleTimeline(): void {
  timelineVisible.value = !timelineVisible.value;
  persistState({ timelineVisible: timelineVisible.value });
}

export function toggleGhostLines(): void {
  ghostOverride.value = !showGhostLines.value;
}

export const minimapOverride = signal<boolean | undefined>(undefined);
export const showMinimap = computed(() => minimapOverride.value ?? config.value.showMinimap);

export function toggleMinimap(): void {
  minimapOverride.value = !showMinimap.value;
}

export const activeRevision = computed(() => revisions.value[activeIndex.value]);
export const activeView = computed(() => {
  const id = activeRevision.value?.id;
  return id === undefined ? undefined : views.value.get(id);
});

/** Applies a message from the extension host to the store. */
export function applyMessage(message: ExtensionToWebview): void {
  switch (message.type) {
    case 'init':
      init.value = message.payload;
      config.value = message.payload.config;
      theme.value = message.payload.theme;
      empty.value = undefined;
      break;
    case 'history': {
      revisions.value = message.payload.revisions;
      hasMore.value = message.payload.hasMore;
      loadingMore.value = message.payload.loadingMore;
      activeIndex.value = clampIndex(message.payload.activeIndex, message.payload.revisions.length);
      break;
    }
    case 'revision': {
      const next = new Map(views.value);
      next.set(message.payload.id, message.payload);
      views.value = next;
      if (errors.value.has(message.payload.id)) {
        const nextErrors = new Map(errors.value);
        nextErrors.delete(message.payload.id);
        errors.value = nextErrors;
      }
      break;
    }
    case 'revisionError': {
      const next = new Map(errors.value);
      next.set(message.payload.id, message.payload.message);
      errors.value = next;
      break;
    }
    case 'active':
      activeIndex.value = clampIndex(message.payload.index, revisions.value.length);
      evictFarViews();
      break;
    case 'empty':
      empty.value = message.payload;
      busy.value = { busy: false };
      break;
    case 'config':
      config.value = message.payload;
      break;
    case 'theme':
      theme.value = message.payload.theme;
      break;
    case 'busy':
      busy.value = message.payload;
      break;
  }
}

/** User-initiated navigation: update locally for responsiveness, then inform the host. */
export function setActive(index: number): void {
  const clamped = clampIndex(index, revisions.value.length);
  if (clamped === activeIndex.value && revisions.value.length > 0) {
    return;
  }
  activeIndex.value = clamped;
  postToExtension({ type: 'setActive', payload: { index: clamped } });
  if (hasMore.value && !loadingMore.value && clamped >= revisions.value.length - 5) {
    postToExtension({ type: 'loadMore' });
  }
}

/** Positive delta = older (further back in time). */
export function navigate(delta: number): void {
  setActive(activeIndex.value + delta);
}

export function requestLoadMore(): void {
  if (hasMore.value && !loadingMore.value) {
    loadingMore.value = true;
    postToExtension({ type: 'loadMore' });
  }
}

export function resetStore(): void {
  init.value = undefined;
  revisions.value = [];
  hasMore.value = false;
  loadingMore.value = false;
  activeIndex.value = 0;
  views.value = new Map();
  errors.value = new Map();
  empty.value = undefined;
  busy.value = { busy: true };
}

function clampIndex(index: number, length: number): number {
  if (length === 0) {
    return 0;
  }
  return Math.max(0, Math.min(length - 1, index));
}

function evictFarViews(): void {
  const keepRadius = config.value.preloadRevisions * 2 + 1;
  const center = activeIndex.value;
  const keep = new Set<string>();
  for (let i = center - keepRadius; i <= center + keepRadius; i++) {
    const id = revisions.value[i]?.id;
    if (id !== undefined) {
      keep.add(id);
    }
  }
  let changed = false;
  const next = new Map(views.value);
  for (const id of next.keys()) {
    if (!keep.has(id)) {
      next.delete(id);
      changed = true;
    }
  }
  if (changed) {
    views.value = next;
  }
}
