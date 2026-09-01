import { busy, empty, init, revisions, timelineVisible } from '../state/store';
import { Timeline } from './Timeline';
import { EmptyStateView } from './EmptyStateView';
import { RevisionDeck } from './RevisionDeck';
import { Toolbar } from './Toolbar';

export function App() {
  const state = empty.value;
  const loading = busy.value;
  const ready = init.value !== undefined;
  return (
    <div class="ftm-app">
      <Toolbar />
      <main class="ftm-main">
        {state ? (
          <EmptyStateView state={state} />
        ) : !ready || (loading.busy && revisions.value.length === 0) ? (
          <div class="ftm-loading" role="status" aria-live="polite">
            <span class="codicon codicon-loading codicon-modifier-spin" aria-hidden="true" />
            <span>{loading.message ?? 'Loading history…'}</span>
          </div>
        ) : (
          <>
            <RevisionDeck />
            {timelineVisible.value ? <Timeline /> : null}
          </>
        )}
      </main>
    </div>
  );
}
