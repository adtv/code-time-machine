import { useEffect, useRef } from 'preact/hooks';
import type { RevisionView } from '../../shared/messages/protocol';
import type { RevisionMeta } from '../../shared/models/revision';
import { scrollSync } from '../interaction/sync';
import { CodeView } from '../rendering/codeView';
import { Minimap, readMinimapColors } from '../rendering/minimap';
import { getCodeView, registerCodeView } from '../rendering/registry';
import { changeNav, jumpToChange, refreshChangeNav } from '../interaction/changeNavigation';
import { buildRows } from '../rendering/rows';
import { revisions, showGhostLines, showMinimap, theme } from '../state/store';
import { CommitActions } from './CommitActions';
import { CommitHeader, formatDate } from './CommitHeader';
import { gapSincePrevious } from './format';
import { slotFor } from './RevisionDeck';

export interface RevisionCardProps {
  revision: RevisionMeta;
  view: RevisionView | undefined;
  error: string | undefined;
  /** 0 = active; negative = newer (stacked above); positive = older (stacked below). */
  offset: number;
  /** Index in the history list (for actions). */
  index: number;
  onActivate?: () => void;
}

export const ROW_HEIGHT = 20;

export function RevisionCard({
  revision,
  view,
  error,
  offset,
  index,
  onActivate,
}: RevisionCardProps) {
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
      <CommitHeader
        revision={revision}
        actions={isActive ? <CommitActions revision={revision} index={index} /> : undefined}
      />
      <CardBody view={view} error={error} active={isActive} />
      <footer class="ctm-card-footer" aria-hidden={!isActive}>
        {isActive ? (
          <ActiveStatus view={view} revision={revision} previous={revisions.value[index + 1]} />
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
  const canvas = useRef<HTMLCanvasElement>(null);
  const codeView = useRef<CodeView>();
  const minimap = useRef<Minimap>();
  const isActive = useRef(active);
  isActive.current = active;
  const showGhost = showGhostLines.value;
  const withMinimap = active && showMinimap.value;
  const currentTheme = theme.value;

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
    const unsubscribe = instance.subscribeScroll(() => {
      if (isActive.current) {
        refreshChangeNav(instance);
      }
    });
    return () => {
      unsubscribe();
      unregister();
      instance.dispose();
      codeView.current = undefined;
    };
  }, [view.id]);

  useEffect(() => {
    if (active) {
      refreshChangeNav(codeView.current);
    }
  }, [active, view, showGhost]);

  useEffect(() => {
    const model = buildRows(view, showGhost);
    codeView.current?.setModel(model);
    minimap.current?.setModel(model);
    scrollSync.onCardReady(view.id);
  }, [view, showGhost]);

  // The minimap exists only on the active card (background cards are dimmed and non-interactive).
  useEffect(() => {
    const el = canvas.current;
    const code = codeView.current;
    if (!withMinimap || !el || !code) {
      return;
    }
    const instance = new Minimap(el, code, () => readMinimapColors(el));
    instance.setModel(buildRows(view, showGhost));
    minimap.current = instance;
    return () => {
      instance.dispose();
      minimap.current = undefined;
    };
  }, [withMinimap, view.id]);

  useEffect(() => {
    // Theme changes swap the palette variables; repaint on the next frame so CSS has applied.
    const id = requestAnimationFrame(() => minimap.current?.refreshTheme());
    return () => cancelAnimationFrame(id);
  }, [currentTheme]);

  return (
    <div class="ctm-code-wrap">
      <div
        ref={container}
        class="ctm-code"
        tabIndex={active ? 0 : -1}
        role="table"
        aria-label="Source code"
      />
      {withMinimap ? <canvas ref={canvas} class="ctm-minimap" aria-hidden="true" /> : null}
    </div>
  );
}

/** Status line of the active card: size, line endings and the change against the previous revision. */
function ActiveStatus({
  view,
  revision,
  previous,
}: {
  view: RevisionView | undefined;
  revision: RevisionMeta;
  previous: RevisionMeta | undefined;
}) {
  const gap = gapSincePrevious(revision, previous);
  const nav = changeNav.value;
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
          {nav && nav.total > 0 ? (
            <span class="ctm-change-nav" role="group" aria-label="Change blocks">
              <button
                type="button"
                class="ctm-icon-button ctm-change-button"
                title="Previous change (P, Shift+F7)"
                aria-label="Previous change"
                onClick={() => jumpToChange(getCodeView(revision.id), -1)}
              >
                <span class="codicon codicon-arrow-up" aria-hidden="true" />
              </button>
              <span class="ctm-change-count" aria-live="polite">
                {nav.current}/{nav.total} {nav.total === 1 ? 'change' : 'changes'}
              </span>
              <button
                type="button"
                class="ctm-icon-button ctm-change-button"
                title="Next change (N, F7)"
                aria-label="Next change"
                onClick={() => jumpToChange(getCodeView(revision.id), 1)}
              >
                <span class="codicon codicon-arrow-down" aria-hidden="true" />
              </button>
            </span>
          ) : null}
        </>
      ) : (
        <>
          <span aria-hidden="true">·</span>
          <span>first known revision</span>
        </>
      )}
      {gap ? (
        <>
          <span aria-hidden="true">·</span>
          <span class="ctm-footer-gap" title={gap.title}>
            <span class="codicon codicon-history" aria-hidden="true" /> {gap.text}
          </span>
        </>
      ) : null}
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
