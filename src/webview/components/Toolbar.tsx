import { postToExtension } from '../state/messaging';
import { activeIndex, hasMore, init, navigate, revisions } from '../state/store';

export function Toolbar() {
  const info = init.value;
  const total = revisions.value.length;
  const index = activeIndex.value;
  const canNewer = index > 0;
  const canOlder = index < total - 1 || hasMore.value;
  return (
    <header class="ctm-toolbar">
      <div class="ctm-toolbar-file" title={info?.relPath ?? ''}>
        <span class="codicon codicon-history" aria-hidden="true" />
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
        <button
          type="button"
          class="ctm-icon-button"
          title="Refresh"
          aria-label="Refresh history"
          onClick={() => postToExtension({ type: 'refresh' })}
        >
          <span class="codicon codicon-refresh" aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
