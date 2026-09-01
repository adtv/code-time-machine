import type { RevisionMeta } from '../../shared/models/revision';
import { postToExtension } from '../state/messaging';

/** Icon actions shown on the active card's header. Everything is read-only. */
export function CommitActions({ revision, index }: { revision: RevisionMeta; index: number }) {
  const isWorkingTree = revision.kind === 'workingTree';
  const deleted = revision.changeKind === 'D';
  return (
    <span class="ftm-actions" role="group" aria-label="Revision actions">
      {!isWorkingTree ? (
        <button
          type="button"
          class="ftm-icon-button"
          title="Copy commit message"
          aria-label="Copy commit message"
          onClick={(event) => {
            event.stopPropagation();
            postToExtension({
              type: 'copy',
              payload: {
                text: revision.body ? `${revision.subject}\n\n${revision.body}` : revision.subject,
                what: 'message',
              },
            });
          }}
        >
          <span class="codicon codicon-comment" aria-hidden="true" />
        </button>
      ) : null}
      <button
        type="button"
        class="ftm-icon-button"
        title={isWorkingTree ? 'Open file' : 'Open this revision in an editor (read-only)'}
        aria-label="Open this revision in an editor"
        disabled={deleted}
        onClick={(event) => {
          event.stopPropagation();
          postToExtension({ type: 'openRevision', payload: { index } });
        }}
      >
        <span class="codicon codicon-go-to-file" aria-hidden="true" />
      </button>
      {!isWorkingTree ? (
        <button
          type="button"
          class="ftm-icon-button"
          title="Compare with working tree"
          aria-label="Compare with working tree"
          disabled={deleted}
          onClick={(event) => {
            event.stopPropagation();
            postToExtension({ type: 'compareWithWorkingTree', payload: { index } });
          }}
        >
          <span class="codicon codicon-diff" aria-hidden="true" />
        </button>
      ) : null}
    </span>
  );
}
