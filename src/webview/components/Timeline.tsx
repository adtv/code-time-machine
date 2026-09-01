import { useEffect, useRef } from 'preact/hooks';
import type { RevisionMeta } from '../../shared/models/revision';
import {
  activeIndex,
  hasMore,
  loadingMore,
  requestLoadMore,
  revisions,
  setActive,
} from '../state/store';
import { formatDate } from './CommitHeader';

export type Magnitude = 'none' | 'small' | 'medium' | 'large';

/** Buckets a commit's change size; thresholds are deliberately coarse. */
export function magnitudeOf(revision: RevisionMeta): Magnitude {
  const stats = revision.stats;
  if (!stats) {
    return 'none';
  }
  const total = stats.additions + stats.deletions;
  if (total === 0) {
    return 'none';
  }
  if (total <= 5) {
    return 'small';
  }
  if (total <= 50) {
    return 'medium';
  }
  return 'large';
}

/** Coarse date label used to group timeline entries. */
export function dayLabel(timestamp: number, now = Date.now()): string {
  const date = new Date(timestamp);
  const today = new Date(now);
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const dayMs = 86_400_000;
  if (timestamp >= startOfToday) {
    return 'Today';
  }
  if (timestamp >= startOfToday - dayMs) {
    return 'Yesterday';
  }
  const sameYear = date.getFullYear() === today.getFullYear();
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

export function tooltipFor(revision: RevisionMeta): string {
  const id = revision.kind === 'workingTree' ? 'Working Tree' : revision.id.slice(0, 8);
  const stats = revision.stats
    ? revision.stats.binary
      ? 'binary'
      : `+${revision.stats.additions} −${revision.stats.deletions}`
    : '';
  const rename =
    revision.changeKind === 'R' ? `\nrenamed from ${revision.previousPath ?? '?'}` : '';
  return `${id} — ${revision.subject}\n${revision.author.name} · ${formatDate(revision.authorDate)}${stats ? `\n${stats}` : ''}${rename}`;
}

interface Group {
  label: string;
  items: { revision: RevisionMeta; index: number }[];
}

export function groupByDay(list: readonly RevisionMeta[], now = Date.now()): Group[] {
  const groups: Group[] = [];
  list.forEach((revision, index) => {
    const label = revision.kind === 'workingTree' ? 'Now' : dayLabel(revision.authorDate, now);
    const last = groups[groups.length - 1];
    if (last?.label === label) {
      last.items.push({ revision, index });
    } else {
      groups.push({ label, items: [{ revision, index }] });
    }
  });
  return groups;
}

/**
 * Compact vertical timeline: newest at the top. Click or keyboard (↑/↓/Home/End/Enter) selects a
 * revision; the list auto-scrolls to keep the active entry visible and offers "load more".
 */
export function Timeline() {
  const list = revisions.value;
  const active = activeIndex.value;
  const listRef = useRef<HTMLUListElement>(null);
  const groups = groupByDay(list);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active, list.length]);

  const onKeyDown = (event: KeyboardEvent): void => {
    switch (event.key) {
      case 'ArrowDown':
        setActive(active + 1);
        break;
      case 'ArrowUp':
        setActive(active - 1);
        break;
      case 'Home':
        setActive(0);
        break;
      case 'End':
        setActive(list.length - 1);
        break;
      case 'PageDown':
        setActive(active + 10);
        break;
      case 'PageUp':
        setActive(active - 10);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  return (
    <aside class="ctm-timeline" aria-label="Timeline">
      <ul
        ref={listRef}
        class="ctm-timeline-list"
        role="listbox"
        aria-label="Revisions, newest first"
        aria-activedescendant={`ctm-tl-${active}`}
        tabIndex={0}
        onKeyDown={onKeyDown}
      >
        {groups.map((group) => (
          <li key={`${group.label}-${group.items[0]?.index ?? 0}`} class="ctm-timeline-group">
            <div class="ctm-timeline-day" aria-hidden="true">
              {group.label}
            </div>
            <ul class="ctm-timeline-items" role="presentation">
              {group.items.map(({ revision, index }) => (
                <TimelineItem
                  key={revision.id}
                  revision={revision}
                  index={index}
                  active={index === active}
                />
              ))}
            </ul>
          </li>
        ))}
        {hasMore.value ? (
          <li class="ctm-timeline-more" role="presentation">
            <button
              type="button"
              class="ctm-button"
              disabled={loadingMore.value}
              onClick={() => requestLoadMore()}
            >
              {loadingMore.value ? (
                <>
                  <span class="codicon codicon-loading codicon-modifier-spin" aria-hidden="true" />{' '}
                  Loading…
                </>
              ) : (
                'Load older commits'
              )}
            </button>
          </li>
        ) : null}
      </ul>
    </aside>
  );
}

function TimelineItem({
  revision,
  index,
  active,
}: {
  revision: RevisionMeta;
  index: number;
  active: boolean;
}) {
  const magnitude = magnitudeOf(revision);
  const isWorkingTree = revision.kind === 'workingTree';
  return (
    <li
      id={`ctm-tl-${index}`}
      class={`ctm-timeline-item ${active ? 'ctm-timeline-item-active' : ''}`}
      role="option"
      aria-selected={active}
      data-index={index}
      title={tooltipFor(revision)}
      onClick={() => setActive(index)}
    >
      <span class={`ctm-timeline-dot ctm-dot-${magnitude}`} aria-hidden="true">
        {isWorkingTree ? (
          <span class="codicon codicon-edit" />
        ) : revision.isMerge ? (
          <span class="codicon codicon-git-merge" />
        ) : null}
      </span>
      <span class="ctm-timeline-text">
        <span class="ctm-timeline-subject">{revision.subject}</span>
        <span class="ctm-timeline-meta">
          {isWorkingTree ? 'uncommitted' : revision.id.slice(0, 7)} · {revision.author.name}
        </span>
      </span>
    </li>
  );
}
