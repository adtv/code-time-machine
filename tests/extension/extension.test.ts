import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type { CodeTimeMachineApi } from '../../src/extension/extension';

const EXTENSION_ID = 'adtv.file-time-machine';

function folder(name: string): vscode.WorkspaceFolder {
  const found = vscode.workspace.workspaceFolders?.find((f) => f.name === name);
  assert.ok(
    found,
    `workspace folder ${name} must exist (run scripts/prepare-extension-fixtures.mjs)`,
  );
  return found;
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 30_000,
  what = 'condition',
): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error(`timed out waiting for ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe('File Time Machine extension', () => {
  let api: CodeTimeMachineApi;

  before(async function () {
    this.timeout(60_000);
    const extension = vscode.extensions.getExtension<CodeTimeMachineApi>(EXTENSION_ID);
    assert.ok(extension, 'extension is installed in the test host');
    api = await extension.activate();
    // Make sure the built-in git extension is ready too.
    const git = vscode.extensions.getExtension('vscode.git');
    assert.ok(git, 'vscode.git is available');
    await git.activate();
  });

  it('activates and registers its commands', async () => {
    const commands = await vscode.commands.getCommands(true);
    for (const id of [
      'fileTimeMachine.openFileHistory',
      'fileTimeMachine.previousRevision',
      'fileTimeMachine.nextRevision',
      'fileTimeMachine.goToRevision',
      'fileTimeMachine.refresh',
      'fileTimeMachine.openRevisionInEditor',
      'fileTimeMachine.compareWithWorkingTree',
      'fileTimeMachine.showOutput',
    ]) {
      assert.ok(commands.includes(id), `${id} is registered`);
    }
  });

  it('opens the history of a file in the second workspace folder (multi-root, rename followed)', async function () {
    this.timeout(60_000);
    const uri = vscode.Uri.joinPath(folder('repoB').uri, 'src', 'service.ts');
    const panelsBefore = api.panelCount();
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document);
    await vscode.commands.executeCommand('fileTimeMachine.openFileHistory');
    await waitFor(() => api.getSessionSnapshot(uri)?.status === 'ready', 30_000, 'session ready');
    await api.waitForIdle(uri);

    const snapshot = api.getSessionSnapshot(uri);
    assert.ok(snapshot);
    assert.equal(snapshot.status, 'ready');
    assert.equal(snapshot.revisions.length, 6, 'six commits including the rename');
    assert.deepEqual(
      snapshot.revisions.map((r) => r.subject),
      [
        'B: add logging',
        'B: move into src/',
        'B: import validate',
        'B: add validation',
        'B: add start()',
        'B: create service',
      ],
    );
    assert.equal(snapshot.revisions[1]?.changeKind, 'R');
    assert.equal(snapshot.revisions[1]?.previousPath, 'service.ts');
    assert.equal(snapshot.revisions[2]?.path, 'service.ts');
    assert.equal(snapshot.activeIndex, 0);
    assert.ok(
      snapshot.loadedViews.includes(snapshot.revisions[0]?.id ?? ''),
      'active revision loaded',
    );
    assert.ok(
      snapshot.highlightedViews.includes(snapshot.revisions[0]?.id ?? ''),
      'active revision is syntax highlighted (worker)',
    );
    assert.equal(api.panelCount(), panelsBefore + 1);
    await waitFor(
      () =>
        vscode.window.tabGroups.all
          .flatMap((g) => g.tabs)
          .some((t) => t.label === 'History: service.ts'),
      10_000,
      'a webview tab titled "History: service.ts"',
    );
  });

  it('navigates with the previous/next commands', async function () {
    this.timeout(30_000);
    const uri = vscode.Uri.joinPath(folder('repoB').uri, 'src', 'service.ts');
    await vscode.commands.executeCommand('fileTimeMachine.previousRevision');
    await waitFor(() => api.getSessionSnapshot(uri)?.activeIndex === 1, 10_000, 'active index 1');
    await vscode.commands.executeCommand('fileTimeMachine.previousRevision');
    await waitFor(() => api.getSessionSnapshot(uri)?.activeIndex === 2, 10_000, 'active index 2');
    await api.waitForIdle(uri);
    const snapshot = api.getSessionSnapshot(uri);
    assert.ok(snapshot);
    assert.ok(snapshot.loadedViews.includes(snapshot.revisions[2]?.id ?? ''));
    await vscode.commands.executeCommand('fileTimeMachine.nextRevision');
    await waitFor(
      () => api.getSessionSnapshot(uri)?.activeIndex === 1,
      10_000,
      'active index back to 1',
    );
  });

  it('resolves the first workspace folder repository independently', async function () {
    this.timeout(60_000);
    const uri = vscode.Uri.joinPath(folder('repoA').uri, 'a.ts');
    const panelsBefore = api.panelCount();
    await api.openFileHistory(uri);
    await waitFor(
      () => api.getSessionSnapshot(uri)?.status === 'ready',
      30_000,
      'repoA session ready',
    );
    const snapshot = api.getSessionSnapshot(uri);
    assert.ok(snapshot);
    assert.equal(snapshot.revisions.length, 3);
    assert.equal(snapshot.revisions[0]?.subject, 'A: change a, add c');
    assert.equal(api.panelCount(), panelsBefore + 1);
  });

  it('shows an empty state for untracked files', async function () {
    this.timeout(30_000);
    const uri = vscode.Uri.joinPath(folder('repoB').uri, 'untracked.ts');
    await api.openFileHistory(uri);
    await waitFor(() => api.getSessionSnapshot(uri)?.status === 'empty', 30_000, 'empty state');
    assert.equal(api.getSessionSnapshot(uri)?.emptyState?.kind, 'notTracked');
  });

  it('reopening the same file reuses the panel', async () => {
    const uri = vscode.Uri.joinPath(folder('repoA').uri, 'a.ts');
    const before = api.panelCount();
    await api.openFileHistory(uri);
    assert.equal(api.panelCount(), before);
  });
});
