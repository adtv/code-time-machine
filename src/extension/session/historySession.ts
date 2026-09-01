import { diffLines } from '../../shared/diff/lineDiff';
import type {
  EmptyState,
  ExtensionToWebview,
  HighlightedLines,
  RevisionView,
  ThemeKind,
} from '../../shared/messages/protocol';
import {
  WORKING_TREE_ID,
  type RevisionContent,
  type RevisionMeta,
  type TextRevisionContent,
} from '../../shared/models/revision';
import { posixBasename } from '../git/paths';
import { nextHistoryPageSize, toWebviewConfig, type Settings } from '../config/settings';
import { GitError } from '../errors/gitError';
import type { CommitRevisionMeta, FileHistoryProvider } from '../history/fileHistoryProvider';
import type { Logger } from '../logging/logger';
import type { RevisionContentService } from '../revision/revisionContentService';
import type { WorkingTreeReader, WorkingTreeSnapshot } from '../revision/workingTree';
import { buildRevisionView, collectDeletedLines } from './revisionView';

export interface SessionTarget {
  /** Stable identity of the file (URI string). */
  key: string;
  fileFsPath: string;
  repoRoot: string;
  repoName: string;
  /** Repository-relative POSIX path (current name). */
  relPath: string;
  languageId: string;
}

/** Optional syntax highlighter (Phase 9). */
export interface HighlightProvider {
  highlight(
    lines: readonly string[],
    languageId: string,
    theme: ThemeKind,
    signal?: AbortSignal,
  ): Promise<HighlightedLines | undefined>;
}

export interface SessionDeps {
  history: FileHistoryProvider;
  content: RevisionContentService;
  workingTree: WorkingTreeReader;
  highlighter?: HighlightProvider;
  settings: () => Settings;
  theme: () => ThemeKind;
  send: (message: ExtensionToWebview) => void;
  logger: Logger;
}

export type SessionStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'disposed';

export interface SessionSnapshot {
  status: SessionStatus;
  activeIndex: number;
  revisions: readonly RevisionMeta[];
  hasMore: boolean;
  loadedViews: readonly string[];
  emptyState?: EmptyState;
}

/**
 * Orchestrates one file-history view: history pages, the working-tree pseudo revision, the
 * sliding preload window around the active revision, cancellation and the outbound messages.
 * Independent from the webview/vscode APIs so it can be tested against a real git repository.
 */
export class HistorySession {
  private status: SessionStatus = 'idle';
  private commits: CommitRevisionMeta[] = [];
  private revisions: RevisionMeta[] = [];
  private hasMore = false;
  private loadingMore = false;
  private activeIndex = 0;
  private emptyState: EmptyState | undefined;
  private workingTree: WorkingTreeSnapshot | undefined;
  private readonly views = new Map<string, RevisionView>();
  private generation = 0;
  private controller: AbortController | undefined;
  private readonly idle = new Set<Promise<void>>();
  private disposed = false;
  private started = false;

  constructor(
    readonly target: SessionTarget,
    private readonly deps: SessionDeps,
  ) {}

  get snapshot(): SessionSnapshot {
    const snapshot: SessionSnapshot = {
      status: this.status,
      activeIndex: this.activeIndex,
      revisions: this.revisions,
      hasMore: this.hasMore,
      loadedViews: [...this.views.keys()],
    };
    if (this.emptyState) {
      snapshot.emptyState = this.emptyState;
    }
    return snapshot;
  }

  getRevision(index: number): RevisionMeta | undefined {
    return this.revisions[index];
  }

  getCommitMeta(id: string): CommitRevisionMeta | undefined {
    return this.commits.find((c) => c.id === id);
  }

  /** Resolves when no background loading is in flight (tests). */
  async settle(): Promise<void> {
    while (this.idle.size > 0) {
      await Promise.allSettled([...this.idle]);
    }
  }

  async start(): Promise<void> {
    if (this.started) {
      this.resync();
      return;
    }
    this.started = true;
    const settings = this.deps.settings();
    this.deps.send({
      type: 'init',
      payload: {
        fileName: posixBasename(this.target.relPath),
        relPath: this.target.relPath,
        repoName: this.target.repoName,
        languageId: this.target.languageId,
        theme: this.deps.theme(),
        config: toWebviewConfig(settings),
      },
    });
    await this.reload(nextHistoryPageSize(0, settings.maxCommits), undefined);
  }

  async refresh(): Promise<void> {
    const activeId = this.revisions[this.activeIndex]?.id;
    const count = Math.max(
      this.commits.length,
      nextHistoryPageSize(0, this.deps.settings().maxCommits),
    );
    this.views.clear();
    await this.reload(count, activeId);
  }

  async loadMore(): Promise<void> {
    if (!this.hasMore || this.loadingMore || this.disposed) {
      return;
    }
    const settings = this.deps.settings();
    const maxCount = nextHistoryPageSize(this.commits.length, settings.maxCommits);
    if (maxCount <= this.commits.length) {
      this.hasMore = false;
      this.sendHistory();
      return;
    }
    this.loadingMore = true;
    this.sendHistory();
    try {
      const page = await this.deps.history.getHistory(this.target.repoRoot, this.target.relPath, {
        maxCount,
        followRenames: settings.followRenames,
      });
      if (this.disposed) {
        return;
      }
      const activeId = this.revisions[this.activeIndex]?.id;
      this.commits = page.revisions;
      this.hasMore = page.hasMore && this.commits.length < settings.maxCommits;
      this.rebuildRevisions();
      this.restoreActive(activeId);
    } catch (error) {
      this.deps.logger.error('loading more history failed', error);
    } finally {
      this.loadingMore = false;
    }
    this.sendHistory();
  }

  /** Sets the active revision and (re)fills the preload window around it. */
  setActive(index: number): void {
    if (this.status !== 'ready') {
      return;
    }
    const clamped = Math.max(0, Math.min(this.revisions.length - 1, index));
    this.activeIndex = clamped;
    this.deps.send({ type: 'active', payload: { index: clamped } });
    this.schedulePreload();
  }

  dispose(): void {
    this.disposed = true;
    this.status = 'disposed';
    this.controller?.abort();
    this.views.clear();
  }

  /** Theme changed: highlighted views must be rebuilt with the new palette. */
  onThemeChanged(): void {
    if (!this.deps.highlighter || this.status !== 'ready') {
      return;
    }
    this.views.clear();
    this.schedulePreload();
  }

  /**
   * Re-sends the current state (used when the webview (re)boots after the session started, e.g.
   * the first `ready` arrives after `start()`, or the webview was reloaded).
   */
  resync(): void {
    if (this.disposed) {
      return;
    }
    this.deps.send({
      type: 'init',
      payload: {
        fileName: posixBasename(this.target.relPath),
        relPath: this.target.relPath,
        repoName: this.target.repoName,
        languageId: this.target.languageId,
        theme: this.deps.theme(),
        config: toWebviewConfig(this.deps.settings()),
      },
    });
    if (this.status === 'empty' && this.emptyState) {
      this.deps.send({ type: 'busy', payload: { busy: false } });
      this.deps.send({ type: 'empty', payload: this.emptyState });
      return;
    }
    if (this.status === 'ready') {
      this.sendHistory();
      this.deps.send({ type: 'busy', payload: { busy: false } });
      for (const view of this.views.values()) {
        this.deps.send({ type: 'revision', payload: view });
      }
      this.deps.send({ type: 'active', payload: { index: this.activeIndex } });
      return;
    }
    this.deps.send({ type: 'busy', payload: { busy: true, message: 'Loading history…' } });
  }

  // ---------------------------------------------------------------------------------------------

  private async reload(maxCount: number, keepActiveId: string | undefined): Promise<void> {
    const settings = this.deps.settings();
    this.status = 'loading';
    this.emptyState = undefined;
    this.controller?.abort();
    this.generation++;
    this.deps.send({ type: 'busy', payload: { busy: true, message: 'Loading history…' } });
    try {
      const page = await this.deps.history.getHistory(this.target.repoRoot, this.target.relPath, {
        maxCount,
        followRenames: settings.followRenames,
      });
      if (this.disposed) {
        return;
      }
      this.commits = page.revisions;
      this.hasMore = page.hasMore && this.commits.length < settings.maxCommits;
      if (this.commits.length === 0) {
        const tracked = await this.deps.history.isTracked(
          this.target.repoRoot,
          this.target.relPath,
        );
        this.setEmpty(
          tracked
            ? { kind: 'noCommits', message: 'This file is tracked but has not been committed yet.' }
            : { kind: 'notTracked', message: 'This file is not tracked by Git.' },
        );
        return;
      }
      await this.loadWorkingTree(settings);
      if (this.disposed) {
        return;
      }
      this.rebuildRevisions();
      this.restoreActive(keepActiveId);
      this.status = 'ready';
      this.sendHistory();
      this.deps.send({ type: 'busy', payload: { busy: false } });
      this.setActive(this.activeIndex);
    } catch (error) {
      if (this.disposed) {
        return;
      }
      this.deps.logger.error('history load failed', error);
      this.setEmpty(toEmptyState(error));
    }
  }

  private setEmpty(state: EmptyState): void {
    this.status = 'empty';
    this.emptyState = state;
    this.deps.send({ type: 'busy', payload: { busy: false } });
    this.deps.send({ type: 'empty', payload: state });
  }

  /** Adds the working tree as a pseudo revision when it differs from the newest commit. */
  private async loadWorkingTree(settings: Settings): Promise<void> {
    this.workingTree = undefined;
    const head = this.commits[0];
    if (!head) {
      return;
    }
    const snapshot = await this.deps.workingTree.read(this.target.fileFsPath);
    if (snapshot?.kind !== 'text') {
      return;
    }
    if (head.changeKind === 'D') {
      // Deleted in HEAD but present on disk: treat the disk copy as working tree content.
      this.workingTree = snapshot;
      return;
    }
    const headContent = await this.deps.content.getContent(
      this.target.repoRoot,
      { id: head.id, path: head.path, blobSha: head.blobSha },
      { maxBytes: settings.maxFileSizeBytes },
    );
    if (headContent.kind !== 'text') {
      return;
    }
    const same =
      headContent.lines.length === snapshot.lines.length &&
      headContent.lines.every((line, i) => line === snapshot.lines[i]);
    if (!same) {
      this.workingTree = snapshot;
    }
  }

  private rebuildRevisions(): void {
    const list: RevisionMeta[] = [];
    const head = this.commits[0];
    if (this.workingTree && head) {
      list.push(this.workingTreeMeta(head, this.workingTree));
    }
    for (const commit of this.commits) {
      list.push(stripCommitMeta(commit));
    }
    this.revisions = list;
  }

  private workingTreeMeta(head: CommitRevisionMeta, snapshot: WorkingTreeSnapshot): RevisionMeta {
    const now = Date.now();
    const meta: RevisionMeta = {
      id: WORKING_TREE_ID,
      kind: 'workingTree',
      parents: [head.id],
      author: { name: 'Working Tree' },
      authorDate: now,
      committerDate: now,
      subject: snapshot.dirty ? 'Uncommitted changes (unsaved edits)' : 'Uncommitted changes',
      body: '',
      path: this.target.relPath,
      changeKind: 'WT',
      isMerge: false,
    };
    const headView = this.views.get(head.id);
    const headLines = headView?.content.kind === 'text' ? headView.content.lines : undefined;
    if (headLines) {
      const diff = diffLines(headLines, snapshot.lines, {
        ignoreWhitespace: this.deps.settings().ignoreWhitespace,
      });
      let additions = 0;
      let deletions = 0;
      for (const op of diff.ops) {
        if (op.type !== 'equal') {
          additions += op.bLen;
          deletions += op.aLen;
        }
      }
      meta.stats = { additions, deletions, binary: false };
    }
    return meta;
  }

  private restoreActive(keepActiveId: string | undefined): void {
    if (keepActiveId !== undefined) {
      const idx = this.revisions.findIndex((r) => r.id === keepActiveId);
      if (idx >= 0) {
        this.activeIndex = idx;
        return;
      }
    }
    this.activeIndex = Math.max(0, Math.min(this.revisions.length - 1, this.activeIndex));
  }

  private sendHistory(): void {
    this.deps.send({
      type: 'history',
      payload: {
        revisions: this.revisions,
        hasMore: this.hasMore,
        loadingMore: this.loadingMore,
        activeIndex: this.activeIndex,
      },
    });
  }

  private schedulePreload(): void {
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const generation = ++this.generation;
    const task = this.preload(controller.signal, generation).catch((error: unknown) => {
      if (!GitError.is(error, 'Cancelled')) {
        this.deps.logger.error('preload failed', error);
      }
    });
    this.idle.add(task);
    void task.finally(() => this.idle.delete(task));
  }

  /** Loads the active revision first, then alternates outward: N, N+1 (older), N-1, N+2, N-2… */
  private async preload(signal: AbortSignal, generation: number): Promise<void> {
    const settings = this.deps.settings();
    const center = this.activeIndex;
    const radius = settings.preloadRevisions;
    const order: number[] = [center];
    for (let d = 1; d <= radius; d++) {
      order.push(center + d, center - d);
    }
    for (const index of order) {
      if (signal.aborted || generation !== this.generation || this.status !== 'ready') {
        return;
      }
      if (index < 0 || index >= this.revisions.length) {
        continue;
      }
      await this.ensureView(index, settings, signal);
    }
    this.evictViews(center, radius * 2 + 1);
  }

  private async ensureView(index: number, settings: Settings, signal: AbortSignal): Promise<void> {
    const meta = this.revisions[index];
    if (!meta) {
      return;
    }
    if (this.views.has(meta.id)) {
      return;
    }
    const started = Date.now();
    try {
      const current = await this.contentFor(meta, settings, signal);
      const previousMeta = this.revisions[index + 1];
      const previous = previousMeta
        ? await this.contentFor(previousMeta, settings, signal)
        : undefined;
      if (signal.aborted) {
        return;
      }
      const highlight = await this.highlightFor(current, previous, settings, signal);
      if (signal.aborted) {
        return;
      }
      const view = buildRevisionView(
        current,
        previous,
        {
          ignoreWhitespace: settings.ignoreWhitespace,
          maxRenderedLines: settings.maxRenderedLines,
        },
        highlight,
      );
      this.views.set(meta.id, view);
      this.deps.logger.debug(
        `revision ready ${meta.id.slice(0, 8)} (${current.kind}${view.diffFromPrevious ? ', mapped' : ''}) in ${Date.now() - started}ms`,
      );
      this.deps.send({ type: 'revision', payload: view });
    } catch (error) {
      if (GitError.is(error, 'Cancelled') || signal.aborted) {
        return;
      }
      this.deps.logger.error(`loading revision ${meta.id} failed`, error);
      const code = GitError.is(error) ? error.code : 'Unknown';
      const message = GitError.is(error) ? error.userMessage : 'Failed to load this revision.';
      this.deps.send({ type: 'revisionError', payload: { id: meta.id, code, message } });
    }
  }

  private async contentFor(
    meta: RevisionMeta,
    settings: Settings,
    signal: AbortSignal,
  ): Promise<RevisionContent> {
    if (meta.kind === 'workingTree') {
      const snapshot = this.workingTree;
      const content: TextRevisionContent = {
        kind: 'text',
        id: WORKING_TREE_ID,
        path: meta.path,
        lines: snapshot?.lines ?? [],
        eol: snapshot?.eol ?? 'none',
        byteLength: snapshot?.byteLength ?? 0,
      };
      return content;
    }
    const commit = this.getCommitMeta(meta.id);
    if (meta.changeKind === 'D') {
      return { kind: 'missing', id: meta.id, path: meta.path };
    }
    return this.deps.content.getContent(
      this.target.repoRoot,
      { id: meta.id, path: meta.path, blobSha: commit?.blobSha },
      { maxBytes: settings.maxFileSizeBytes, signal },
    );
  }

  private async highlightFor(
    current: RevisionContent,
    previous: RevisionContent | undefined,
    settings: Settings,
    signal: AbortSignal,
  ): Promise<{ current?: HighlightedLines; deleted?: HighlightedLines } | undefined> {
    const highlighter = this.deps.highlighter;
    if (
      !highlighter ||
      current.kind !== 'text' ||
      current.lines.length > settings.maxRenderedLines
    ) {
      return undefined;
    }
    const theme = this.deps.theme();
    const result: { current?: HighlightedLines; deleted?: HighlightedLines } = {};
    const own = await highlighter.highlight(current.lines, this.target.languageId, theme, signal);
    if (own) {
      result.current = own;
    }
    if (previous?.kind === 'text') {
      const deleted = collectDeletedLines(previous.lines, current.lines, settings.ignoreWhitespace);
      if (deleted.length > 0) {
        const ghost = await highlighter.highlight(deleted, this.target.languageId, theme, signal);
        if (ghost) {
          result.deleted = ghost;
        }
      }
    }
    return result;
  }

  private evictViews(center: number, keepRadius: number): void {
    const keep = new Set<string>();
    for (let i = center - keepRadius; i <= center + keepRadius; i++) {
      const id = this.revisions[i]?.id;
      if (id) {
        keep.add(id);
      }
    }
    for (const id of [...this.views.keys()]) {
      if (!keep.has(id)) {
        this.views.delete(id);
      }
    }
  }
}

function stripCommitMeta(commit: CommitRevisionMeta): RevisionMeta {
  const { blobSha: _blobSha, ...meta } = commit;
  return meta;
}

export function toEmptyState(error: unknown): EmptyState {
  if (GitError.is(error)) {
    switch (error.code) {
      case 'HistoryUnavailable':
        return { kind: 'noCommits', message: 'This repository has no commits yet.' };
      case 'NotRepository':
        return { kind: 'notRepository', message: error.userMessage };
      case 'GitDisabled':
        return { kind: 'gitDisabled', message: error.userMessage };
      case 'GitNotFound':
        return { kind: 'gitNotFound', message: error.userMessage };
      case 'FileNotTracked':
        return { kind: 'notTracked', message: error.userMessage };
      case 'BinaryFile':
        return { kind: 'binary', message: error.userMessage };
      case 'RevisionNotFound':
      case 'FileTooLarge':
      case 'GitCommandFailed':
      case 'Cancelled':
        return { kind: 'error', message: error.userMessage, detail: error.message };
    }
  }
  return {
    kind: 'error',
    message: 'Something went wrong while loading the history.',
    detail: error instanceof Error ? error.message : String(error),
  };
}
