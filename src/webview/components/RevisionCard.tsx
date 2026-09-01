import { useEffect, useRef } from 'preact/hooks';
import type { RevisionView } from '../../shared/messages/protocol';
import type { RevisionMeta } from '../../shared/models/revision';
import { scrollSync } from '../interaction/sync';
import { CodeView } from '../rendering/codeView';
import { registerCodeView } from '../rendering/registry';
import { buildRows } from '../rendering/rows';
import { config } from '../state/store';
import { CommitHeader, formatDate } from './CommitHeader';
import { slotFor } from './RevisionDeck';

export interface RevisionCardProps {
  revision: RevisionMeta;
  view: RevisionView | undefined;
  error: string | undefined;
  /** 0 = active; negative = newer (stacked above); positive = older (stacked below). */
  offset: number;
  onActivate?: () => void;
}

export const ROW_HEIGHT = 20;

export function RevisionCard({ revision, view, error, offset, onActivate }: RevisionCardProps) {
  const isActive = offset === 0;
  const slot = slotFor(offset);
  const shortHash = revision.kind === 'workingTree' ? 'Working Tree' : revision.id.slice(0, 8);
  return (
    <article
      class={`ctm-card ${isActive ? 'ctm-card-active' : 'ctm-card-background'}`}
      data-offset={offset}
      data-slot={slot}
      aria-hidden={!isActive}
      aria-label={`Revision ${shortHash}: ${revision.subject}`}
      title={isActive ? undefined : `Go to ${shortHash} — ${revision.subject}`}
      onClick={isActive ? undefined : onActivate}
    >
      <CommitHeader revision={revision} />
      <CardBody view={view} error={error} active={isActive} />
      <footer class="ctm-card-footer" aria-hidden={!isActive}>
        {isActive ? (
          <ActiveStatus view={view} />
        ) : (
          <>
            <div class="ctm-footer-line">
              <span class="ctm-footer-hash">{shortHash}</span>
              <span class="ctm-footer-subject">{revision.subject}</span>
            </div>
            <div class="ctm-footer-line ctm-footer-meta">
              <span>{revision.author.name}</span>
              <span aria-hidden="true">·</span>
              <span>{formatDate(revision.authorDate)}</span>
            </div>
          </>
        )}
      </footer>
    </article>
  );
}

function CardBody({
  view,
  error,
  active,
}: {
  view: RevisionView | undefined;
  error: string | undefined;
  active: boolean;
}) {
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
      return <CodeViewHost view={view} active={active} />;
  }
}

function CodeViewHost({ view, active }: { view: RevisionView; active: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const codeView = useRef<CodeView>();
  const isActive = useRef(active);
  isActive.current = active;
  const showGhost = config.value.showGhostLines;

  useEffect(() => {
    const el = container.current;
    if (!el) {
      return;
    }
    const instance = new CodeView(el, {
      rowHeight: ROW_HEIGHT,
      overscan: 20,
      onUserScroll: () => {
        if (isActive.current) {
          scrollSync.onActiveScrolled();
        }
      },
    });
    codeView.current = instance;
    const unregister = registerCodeView(view.id, instance);
    return () => {
      unregister();
      instance.dispose();
      codeView.current = undefined;
    };
  }, [view.id]);

  useEffect(() => {
    codeView.current?.setModel(buildRows(view, showGhost));
    scrollSync.onCardReady(view.id);
  }, [view, showGhost]);

  return (
    <div
      ref={container}
      class="ctm-code"
      tabIndex={active ? 0 : -1}
      role="table"
      aria-label="Source code"
    />
  );
}

/** Status line of the active card: size, line endings and the change against the previous revision. */
function ActiveStatus({ view }: { view: RevisionView | undefined }) {
  if (!view) {
    return <div class="ctm-footer-status">Loading…</div>;
  }
  if (view.content.kind !== 'text') {
    return (
      <div class="ctm-footer-status">
        {view.content.kind === 'missing' ? 'File absent at this revision' : view.content.kind}
      </div>
    );
  }
  const diff = view.diffFromPrevious;
  let added = 0;
  let removed = 0;
  if (diff) {
    for (const op of diff.ops) {
      if (op.type !== 'equal') {
        added += op.bLen;
        removed += op.aLen;
      }
    }
  }
  return (
    <div class="ctm-footer-status" role="status">
      <span>{view.content.lines.length} lines</span>
      <span aria-hidden="true">·</span>
      <span>{view.content.eol}</span>
      {diff ? (
        <>
          <span aria-hidden="true">·</span>
          <span>
            vs previous: <span class="ctm-stat-add">+{added}</span>{' '}
            <span class="ctm-stat-del">−{removed}</span>
          </span>
        </>
      ) : (
        <>
          <span aria-hidden="true">·</span>
          <span>first known revision</span>
        </>
      )}
      {view.simplified ? (
        <>
          <span aria-hidden="true">·</span>
          <span>simplified mode</span>
        </>
      ) : null}
    </div>
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
