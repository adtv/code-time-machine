import type { EmptyState } from '../../shared/messages/protocol';
import { postToExtension } from '../state/messaging';

const ICONS: Record<EmptyState['kind'], string> = {
  notTracked: 'codicon-file',
  noCommits: 'codicon-git-commit',
  notRepository: 'codicon-source-control',
  gitDisabled: 'codicon-circle-slash',
  gitNotFound: 'codicon-warning',
  binary: 'codicon-file-binary',
  error: 'codicon-error',
};

const TITLES: Record<EmptyState['kind'], string> = {
  notTracked: 'Not tracked by Git',
  noCommits: 'No commits yet',
  notRepository: 'Not a Git repository',
  gitDisabled: 'Git is disabled',
  gitNotFound: 'Git not found',
  binary: 'Binary file',
  error: 'Something went wrong',
};

export function EmptyStateView({ state }: { state: EmptyState }) {
  return (
    <section class="ftm-empty" role="status" aria-live="polite">
      <span class={`codicon ${ICONS[state.kind]} ftm-empty-icon`} aria-hidden="true" />
      <h2>{TITLES[state.kind]}</h2>
      <p>{state.message}</p>
      {state.detail ? <p class="ftm-empty-detail">{state.detail}</p> : null}
      <div class="ftm-empty-actions">
        <button
          type="button"
          class="ftm-button"
          onClick={() => postToExtension({ type: 'refresh' })}
        >
          <span class="codicon codicon-refresh" aria-hidden="true" /> Retry
        </button>
      </div>
    </section>
  );
}
