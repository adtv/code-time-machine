import { useEffect, useRef } from 'preact/hooks';
import type { RevisionView } from '../../shared/messages/protocol';
import type { RevisionMeta } from '../../shared/models/revision';
import { CodeView } from '../rendering/codeView';
import { buildRows } from '../rendering/rows';
import { config } from '../state/store';
import { CommitHeader } from './CommitHeader';

export interface RevisionCardProps {
  revision: RevisionMeta;
  view: RevisionView | undefined;
  error: string | undefined;
  /** 0 = active; negative = newer (in front/above); positive = older (behind). */
  offset: number;
}

export const ROW_HEIGHT = 20;

export function RevisionCard({ revision, view, error, offset }: RevisionCardProps) {
  const isActive = offset === 0;
  return (
    <article
      class={`ctm-card ${isActive ? 'ctm-card-active' : ''}`}
      data-offset={offset}
      aria-hidden={!isActive}
      aria-label={`Revision ${revision.id.slice(0, 8)}: ${revision.subject}`}
    >
      <CommitHeader revision={revision} />
      <CardBody view={view} error={error} />
    </article>
  );
}

function CardBody({ view, error }: { view: RevisionView | undefined; error: string | undefined }) {
  if (error) {
    return (
      <div class="ctm-card-message" role="alert">
        <span class="codicon codicon-error" aria-hidden="true" /> {error}
      </div>
    );
  }
  if (!view) {
    return (
      <div class="ctm-card-message" role="status">
        <span class="codicon codicon-loading codicon-modifier-spin" aria-hidden="true" /> Loading
        revision…
      </div>
    );
  }
  switch (view.content.kind) {
    case 'binary':
      return (
        <div class="ctm-card-message">
          <span class="codicon codicon-file-binary" aria-hidden="true" /> Visual history for binary
          files is not supported yet ({formatBytes(view.content.byteLength)}).
        </div>
      );
    case 'tooLarge':
      return (
        <div class="ctm-card-message">
          <span class="codicon codicon-warning" aria-hidden="true" /> This revision is too large to
          render ({formatBytes(view.content.byteLength)}, limit {formatBytes(view.content.limit)}).
          Increase “visualGitHistory.maxFileSizeKB” to view it.
        </div>
      );
    case 'missing':
      return (
        <div class="ctm-card-message">
          <span class="codicon codicon-trash" aria-hidden="true" /> The file does not exist at this
          revision (it was deleted).
        </div>
      );
    case 'text':
      return <CodeViewHost view={view} />;
  }
}

function CodeViewHost({ view }: { view: RevisionView }) {
  const container = useRef<HTMLDivElement>(null);
  const codeView = useRef<CodeView>();
  const showGhost = config.value.showGhostLines;

  useEffect(() => {
    const el = container.current;
    if (!el) {
      return;
    }
    const instance = new CodeView(el, { rowHeight: ROW_HEIGHT, overscan: 20 });
    codeView.current = instance;
    return () => {
      instance.dispose();
      codeView.current = undefined;
    };
  }, []);

  useEffect(() => {
    codeView.current?.setModel(buildRows(view, showGhost));
  }, [view, showGhost]);

  return (
    <div ref={container} class="ctm-code" tabIndex={0} role="table" aria-label="Source code" />
  );
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
