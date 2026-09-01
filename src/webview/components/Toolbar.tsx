import { postToExtension } from '../state/messaging';
import {
  activeIndex,
  hasMore,
  init,
  navigate,
  revisions,
  showGhostLines,
  showMinimap,
  timelineVisible,
  toggleGhostLines,
  toggleMinimap,
  toggleTimeline,
} from '../state/store';

export function Toolbar() {
  const info = init.value;
  const total = revisions.value.length;
  const index = activeIndex.value;
  const canNewer = index > 0;
  const canOlder = index < total - 1 || hasMore.value;
  return (
    <header class="ctm-toolbar">
      <div class="ctm-toolbar-file" title={info?.relPath ?? ''}>
        <span class="codicon codicon-versions" aria-hidden="true" />
        <span class="ctm-toolbar-name">{info?.fileName ?? ''}</span>
        {info?.repoName ? <span class="ctm-toolbar-repo">{info.repoName}</span> : null}
      </div>
      <div class="ctm-toolbar-nav" role="group" aria-label="Time travel">
        <button
          type="button"
          class="ctm-icon-button"
          title="Newer revision (K, Alt+↑)"
          aria-label="Newer revision"
          disabled={!canNewer}
          onClick={() => navigate(-1)}
        >
          <span class="codicon codicon-arrow-up" aria-hidden="true" />
        </button>
        <span class="ctm-toolbar-position" aria-live="polite">
          {total === 0 ? '—' : `${index + 1} / ${total}${hasMore.value ? '+' : ''}`}
        </span>
        <button
          type="button"
          class="ctm-icon-button"
          title="Older revision (J, Alt+↓)"
          aria-label="Older revision"
          disabled={!canOlder}
          onClick={() => navigate(+1)}
        >
          <span class="codicon codicon-arrow-down" aria-hidden="true" />
        </button>
        <span class="ctm-toolbar-separator" aria-hidden="true" />
        <button
          type="button"
          class={`ctm-icon-button ${showGhostLines.value ? 'ctm-icon-button-on' : ''}`}
          title={
            showGhostLines.value
              ? 'Hide removed lines (ghost lines)'
              : 'Show removed lines (ghost lines)'
          }
          aria-label="Toggle ghost lines"
          aria-pressed={showGhostLines.value}
          onClick={() => toggleGhostLines()}
        >
          <span class="codicon codicon-diff-removed" aria-hidden="true" />
        </button>
        <button
          type="button"
          class={`ctm-icon-button ${showMinimap.value ? 'ctm-icon-button-on' : ''}`}
          title={showMinimap.value ? 'Hide minimap' : 'Show minimap'}
          aria-label="Toggle minimap"
          aria-pressed={showMinimap.value}
          onClick={() => toggleMinimap()}
        >
          <span class="codicon codicon-map" aria-hidden="true" />
        </button>
        <button
          type="button"
          class={`ctm-icon-button ${timelineVisible.value ? 'ctm-icon-button-on' : ''}`}
          title={timelineVisible.value ? 'Hide timeline' : 'Show timeline'}
          aria-label="Toggle timeline"
          aria-pressed={timelineVisible.value}
          onClick={() => toggleTimeline()}
        >
          <span class="codicon codicon-list-tree" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="ctm-icon-button"
          title="Refresh (R)"
          aria-label="Refresh history"
          onClick={() => postToExtension({ type: 'refresh' })}
        >
          <span class="codicon codicon-refresh" aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
