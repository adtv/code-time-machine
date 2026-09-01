import path from 'node:path';
import type * as vscode from 'vscode';
import { registerCommands } from './commands/registerCommands';
import { RepositoryResolver } from './git/repositoryResolver';
import { WorkerHighlightService } from './highlight/highlightService';
import { OutputChannelLogger } from './logging/outputChannelLogger';
import { VsCodeWorkingTreeReader } from './revision/workingTree';
import type { SessionSnapshot } from './session/historySession';
import { PanelManager } from './webview/panelManager';

/** Small API surface used by the extension tests (and potentially other extensions). */
export interface CodeTimeMachineApi {
  openFileHistory(uri: vscode.Uri): Promise<void>;
  getSessionSnapshot(uri: vscode.Uri): SessionSnapshot | undefined;
  waitForIdle(uri: vscode.Uri): Promise<void>;
  onDidChange: vscode.Event<string>;
  panelCount(): number;
}

export function activate(context: vscode.ExtensionContext): CodeTimeMachineApi {
  const logger = new OutputChannelLogger();
  context.subscriptions.push(logger);
  logger.info('File Time Machine activated');

  const resolver = new RepositoryResolver(logger);
  const highlighter = new WorkerHighlightService(
    path.join(context.extensionUri.fsPath, 'dist', 'highlight-worker.js'),
    logger,
  );
  context.subscriptions.push(highlighter);
  const manager = new PanelManager({
    extensionUri: context.extensionUri,
    resolver,
    workingTree: new VsCodeWorkingTreeReader(),
    highlighter,
    logger,
  });
  context.subscriptions.push(manager);
  registerCommands(context, manager, logger);

  return {
    openFileHistory: (uri) => manager.open(uri),
    getSessionSnapshot: (uri) => manager.getSnapshot(uri),
    waitForIdle: (uri) => manager.waitForIdle(uri),
    onDidChange: manager.onDidChange,
    panelCount: () => manager.size,
  };
}

export function deactivate(): void {
  // Everything is disposed through context.subscriptions.
}
