import { activeRevision, activeView, errors } from '../state/store';
import { RevisionCard } from './RevisionCard';

/** Phase 4: renders the active revision. The layered deck arrives in Phase 5. */
export function RevisionDeck() {
  const revision = activeRevision.value;
  if (!revision) {
    return <div class="ctm-deck" />;
  }
  const error = errors.value.get(revision.id);
  return (
    <div class="ctm-deck">
      <RevisionCard revision={revision} view={activeView.value} error={error} offset={0} />
    </div>
  );
}
