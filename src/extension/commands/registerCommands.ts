import * as vscode from 'vscode';
import type { Logger } from '../logging/logger';
import type { OutputChannelLogger } from '../logging/outputChannelLogger';
import type { PanelManager } from '../webview/panelManager';

export function registerCommands(
  context: vscode.ExtensionContext,
  manager: PanelManager,
  logger: Logger & Pick<OutputChannelLogger, 'show'>,
): void {
  const register = (id: string, handler: (...args: unknown[]) => unknown): void => {
    context.subscriptions.push(
      vscode.commands.registerCommand(id, async (...args: unknown[]) => {
        try {
          await handler(...args);
        } catch (error) {
          logger.error(`command ${id} failed`, error);
          void vscode.window.showErrorMessage(
            'Visual Git History: the command failed. See the output log for details.',
          );
        }
      }),
    );
  };

  register('codeTimeMachine.openFileHistory', async (resource?: unknown) => {
    const target = resolveTarget(resource);
    if (!target) {
      void vscode.window.showInformationMessage('Open a file to visualise its Git history.');
      return;
    }
    await manager.open(target.uri, target.languageId);
  });
  register('codeTimeMachine.previousRevision', () => manager.navigate(+1));
  register('codeTimeMachine.nextRevision', () => manager.navigate(-1));
  register('codeTimeMachine.goToRevision', () => manager.goToRevision());
  register('codeTimeMachine.refresh', () => manager.refreshActive());
  register('codeTimeMachine.openRevisionInEditor', () => manager.openRevisionInEditor());
  register('codeTimeMachine.compareWithWorkingTree', () => manager.compareWithWorkingTree());
  register('codeTimeMachine.showOutput', () => logger.show());
}

function resolveTarget(resource: unknown): { uri: vscode.Uri; languageId?: string } | undefined {
  if (resource instanceof vscode.Uri) {
    const doc = vscode.workspace.textDocuments.find(
      (d) => d.uri.toString() === resource.toString(),
    );
    return doc ? { uri: resource, languageId: doc.languageId } : { uri: resource };
  }
  const editor = vscode.window.activeTextEditor;
  if (editor?.document.uri.scheme === 'file') {
    return { uri: editor.document.uri, languageId: editor.document.languageId };
  }
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
  const uri = (tab?.input as { uri?: unknown } | undefined)?.uri;
  if (uri instanceof vscode.Uri) {
    return uri.scheme === 'file' ? { uri } : undefined;
  }
  return undefined;
}
