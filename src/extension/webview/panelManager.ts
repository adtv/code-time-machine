import path from 'node:path';
import * as vscode from 'vscode';
import type { ThemeKind, WebviewToExtension } from '../../shared/messages/protocol';
import { WORKING_TREE_ID, type RevisionMeta } from '../../shared/models/revision';
import { RevisionCache } from '../cache/revisionCache';
import { readSettings, toWebviewConfig, type Settings } from '../config/settings';
import { GitError } from '../errors/gitError';
import { GitCli } from '../git/gitCli';
import type { RepositoryResolver, ResolvedFile } from '../git/repositoryResolver';
import { FileHistoryProvider } from '../history/fileHistoryProvider';
import type { Logger } from '../logging/logger';
import { RevisionContentService } from '../revision/revisionContentService';
import type { WorkingTreeReader } from '../revision/workingTree';
import {
  HistorySession,
  toEmptyState,
  type HighlightProvider,
  type SessionSnapshot,
} from '../session/historySession';
import { HistoryPanel } from './historyPanel';

interface Entry {
  key: string;
  uri: vscode.Uri;
  panel: HistoryPanel;
  session?: HistorySession;
  resolved?: ResolvedFile;
}

export interface PanelManagerDeps {
  extensionUri: vscode.Uri;
  resolver: RepositoryResolver;
  workingTree: WorkingTreeReader;
  highlighter?: HighlightProvider;
  logger: Logger;
}

/**
 * Creates and tracks one history panel per file, wiring webview messages to the session and
 * exposing the operations behind the extension's commands.
 */
export class PanelManager implements vscode.Disposable {
  private readonly entries = new Map<string, Entry>();
  private readonly cache = new RevisionCache();
  private lastActive: Entry | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly changeEmitter = new vscode.EventEmitter<string>();
  /** Fires with the file key whenever a session sends a message (tests / status). */
  readonly onDidChange = this.changeEmitter.event;

  constructor(private readonly deps: PanelManagerDeps) {
    this.disposables.push(
      vscode.window.onDidChangeActiveColorTheme(() => {
        const theme = currentTheme();
        for (const entry of this.entries.values()) {
          entry.panel.post({ type: 'theme', payload: { theme } });
          void entry.session?.onThemeChanged();
        }
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (!event.affectsConfiguration('visualGitHistory')) {
          return;
        }
        const settings = this.settings();
        const structural =
          event.affectsConfiguration('visualGitHistory.followRenames') ||
          event.affectsConfiguration('visualGitHistory.ignoreWhitespace') ||
          event.affectsConfiguration('visualGitHistory.maxCommits') ||
          event.affectsConfiguration('visualGitHistory.maxFileSizeKB');
        for (const entry of this.entries.values()) {
          entry.panel.post({ type: 'config', payload: toWebviewConfig(settings) });
          if (structural) {
            void entry.session?.refresh();
          }
        }
      }),
    );
  }

  settings(): Settings {
    const config = vscode.workspace.getConfiguration('visualGitHistory');
    return readSettings({ get: <T>(key: string) => config.get<T>(key) });
  }

  async open(uri: vscode.Uri, languageId?: string): Promise<void> {
    const key = uri.toString();
    const existing = this.entries.get(key);
    if (existing) {
      existing.panel.reveal();
      this.lastActive = existing;
      return;
    }
    const fileName = path.basename(uri.fsPath);
    const panel = new HistoryPanel(
      this.deps.extensionUri,
      `History: ${fileName}`,
      this.deps.logger,
    );
    const entry: Entry = { key, uri, panel };
    this.entries.set(key, entry);
    this.lastActive = entry;
    this.updateContext();
    panel.onDidDispose(() => {
      entry.session?.dispose();
      this.entries.delete(key);
      if (this.lastActive === entry) {
        this.lastActive = undefined;
      }
      this.updateContext();
      this.changeEmitter.fire(key);
    });
    panel.panel.onDidChangeViewState((event) => {
      if (event.webviewPanel.active) {
        this.lastActive = entry;
      }
    });

    let resolved: ResolvedFile;
    try {
      resolved = await this.deps.resolver.resolve(uri);
    } catch (error) {
      this.deps.logger.error(`cannot open history for ${uri.fsPath}`, error);
      const language = languageId ?? languageIdFor(uri);
      panel.post({
        type: 'init',
        payload: {
          fileName,
          relPath: fileName,
          repoName: '',
          languageId: language,
          theme: currentTheme(),
          config: toWebviewConfig(this.settings()),
        },
      });
      panel.post({ type: 'empty', payload: toEmptyState(error) });
      this.changeEmitter.fire(key);
      return;
    }
    entry.resolved = resolved;

    const git = new GitCli(resolved.gitPath, this.deps.logger);
    const session = new HistorySession(
      {
        key,
        fileFsPath: uri.fsPath,
        repoRoot: resolved.repoRoot,
        repoName: path.basename(resolved.repoRoot),
        relPath: resolved.relPath,
        languageId: languageId ?? languageIdFor(uri),
      },
      {
        history: new FileHistoryProvider(git, this.deps.logger),
        content: new RevisionContentService(git, this.cache, this.deps.logger),
        workingTree: this.deps.workingTree,
        ...(this.deps.highlighter ? { highlighter: this.deps.highlighter } : {}),
        settings: () => this.settings(),
        theme: currentTheme,
        send: (message) => {
          panel.post(message);
          this.changeEmitter.fire(key);
        },
        logger: this.deps.logger,
      },
    );
    entry.session = session;
    panel.onDidReceiveMessage((message) => {
      void this.handleMessage(entry, message);
    });
    // Start loading right away; the panel queues outbound messages until the webview is ready.
    void session.start().catch((error: unknown) => {
      this.deps.logger.error('session start failed', error);
    });
  }

  getSnapshot(uri: vscode.Uri): SessionSnapshot | undefined {
    return this.entries.get(uri.toString())?.session?.snapshot;
  }

  getActiveEntryUri(): vscode.Uri | undefined {
    return this.activeEntry()?.uri;
  }

  get size(): number {
    return this.entries.size;
  }

  async waitForIdle(uri: vscode.Uri): Promise<void> {
    await this.entries.get(uri.toString())?.session?.settle();
  }

  navigate(delta: number): void {
    const entry = this.activeEntry();
    if (!entry?.session) {
      return;
    }
    entry.session.setActive(entry.session.snapshot.activeIndex + delta);
  }

  async refreshActive(): Promise<void> {
    await this.activeEntry()?.session?.refresh();
  }

  async goToRevision(): Promise<void> {
    const entry = this.activeEntry();
    const session = entry?.session;
    if (!session) {
      return;
    }
    const { revisions, activeIndex } = session.snapshot;
    const items = revisions.map((revision, index) => ({
      label: `${index === activeIndex ? '$(arrow-right) ' : ''}${revision.kind === 'workingTree' ? 'Working Tree' : `$(git-commit) ${revision.id.slice(0, 8)}`}  ${revision.subject}`,
      description: `${revision.author.name} · ${new Date(revision.authorDate).toLocaleString()}`,
      detail:
        revision.changeKind === 'R'
          ? `${revision.previousPath ?? ''} → ${revision.path}`
          : revision.path,
      index,
    }));
    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: 'Go to revision',
      matchOnDescription: true,
      matchOnDetail: true,
    });
    if (picked) {
      session.setActive(picked.index);
      entry?.panel.reveal();
    }
  }

  async openRevisionInEditor(index?: number): Promise<void> {
    const entry = this.activeEntry();
    const session = entry?.session;
    if (!entry?.session || !entry.resolved || !session) {
      return;
    }
    const revision = session.getRevision(index ?? session.snapshot.activeIndex);
    if (!revision) {
      return;
    }
    if (revision.kind === 'workingTree') {
      await vscode.window.showTextDocument(entry.uri, { preview: true });
      return;
    }
    if (revision.changeKind === 'D') {
      void vscode.window.showInformationMessage('The file was deleted in this commit.');
      return;
    }
    const gitUri = this.revisionUri(entry.resolved, revision);
    await vscode.window.showTextDocument(gitUri, { preview: true });
  }

  async compareWithWorkingTree(index?: number): Promise<void> {
    const entry = this.activeEntry();
    const session = entry?.session;
    if (!entry?.resolved || !session) {
      return;
    }
    const revision = session.getRevision(index ?? session.snapshot.activeIndex);
    if (!revision || revision.kind === 'workingTree') {
      return;
    }
    if (revision.changeKind === 'D') {
      void vscode.window.showInformationMessage('The file was deleted in this commit.');
      return;
    }
    const left = this.revisionUri(entry.resolved, revision);
    const title = `${path.basename(revision.path)} (${revision.id.slice(0, 8)}) ↔ Working Tree`;
    await vscode.commands.executeCommand('vscode.diff', left, entry.uri, title, { preview: true });
  }

  dispose(): void {
    for (const entry of [...this.entries.values()]) {
      entry.panel.dispose();
    }
    for (const d of this.disposables.splice(0)) {
      d.dispose();
    }
    this.changeEmitter.dispose();
  }

  private revisionUri(resolved: ResolvedFile, revision: RevisionMeta): vscode.Uri {
    const fileUri = vscode.Uri.joinPath(resolved.repository.rootUri, ...revision.path.split('/'));
    return resolved.api.toGitUri(fileUri, revision.id);
  }

  private activeEntry(): Entry | undefined {
    for (const entry of this.entries.values()) {
      if (entry.panel.active) {
        return entry;
      }
    }
    return this.lastActive ?? this.entries.values().next().value;
  }

  private async handleMessage(entry: Entry, message: WebviewToExtension): Promise<void> {
    const session = entry.session;
    if (!session) {
      return;
    }
    try {
      switch (message.type) {
        case 'ready':
          // The webview (re)booted: replay the current state. (start() is idempotent.)
          await session.start();
          break;
        case 'setActive':
          session.setActive(message.payload.index);
          break;
        case 'loadMore':
          await session.loadMore();
          break;
        case 'refresh':
          await session.refresh();
          break;
        case 'openRevision':
          this.lastActive = entry;
          await this.openRevisionInEditor(message.payload.index);
          break;
        case 'compareWithWorkingTree':
          this.lastActive = entry;
          await this.compareWithWorkingTree(message.payload.index);
          break;
        case 'copy':
          await vscode.env.clipboard.writeText(message.payload.text);
          vscode.window.setStatusBarMessage(
            message.payload.what === 'hash' ? 'Commit hash copied' : 'Commit message copied',
            2000,
          );
          break;
        case 'log':
          this.deps.logger[message.payload.level](`[webview] ${message.payload.message}`);
          break;
      }
    } catch (error) {
      this.deps.logger.error(`handling ${message.type} failed`, error);
      const text = GitError.is(error)
        ? error.userMessage
        : 'Visual Git History: an unexpected error occurred.';
      void vscode.window.showErrorMessage(text);
    }
  }

  private updateContext(): void {
    void vscode.commands.executeCommand(
      'setContext',
      'codeTimeMachine.hasSession',
      this.entries.size > 0,
    );
  }
}

export function currentTheme(): ThemeKind {
  switch (vscode.window.activeColorTheme.kind) {
    case vscode.ColorThemeKind.Light:
      return 'light';
    case vscode.ColorThemeKind.HighContrast:
      return 'highContrast';
    case vscode.ColorThemeKind.HighContrastLight:
      return 'highContrastLight';
    case vscode.ColorThemeKind.Dark:
    default:
      return 'dark';
  }
}

function languageIdFor(uri: vscode.Uri): string {
  const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
  if (open) {
    return open.languageId;
  }
  return 'plaintext';
}

export { WORKING_TREE_ID };
