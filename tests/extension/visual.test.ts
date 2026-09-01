/**
 * Visual harness: only runs when CTM_VISUAL=1. Opens the demo file's history in the real VS Code
 * window and captures screenshots through the Chromium DevTools Protocol (VS Code is launched
 * with --remote-debugging-port, see .vscode-test.mjs). Used to inspect the UI during
 * development; skipped in CI.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as vscode from 'vscode';
import type { CodeTimeMachineApi } from '../../src/extension/extension';

const enabled = process.env['CTM_VISUAL'] === '1';
const cdpPort = process.env['CTM_CDP_PORT'] ?? '9333';
const outDir = process.env['CTM_SHOT_DIR'] ?? path.join(process.cwd(), '.vscode-test', 'shots');

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface CdpTarget {
  type: string;
  url: string;
  title: string;
  webSocketDebuggerUrl: string;
}

async function captureScreenshot(name: string): Promise<void> {
  try {
    const response = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
    const targets = (await response.json()) as CdpTarget[];
    const page = targets.find((t) => t.type === 'page' && t.url.includes('workbench.html'));
    if (!page) {
      console.error(`[visual] no workbench target among ${targets.map((t) => t.url).join(', ')}`);
      return;
    }
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve());
      socket.addEventListener('error', () => reject(new Error('websocket error')));
    });
    const data = await new Promise<string>((resolve, reject) => {
      socket.addEventListener('message', (event) => {
        const message = JSON.parse(String(event.data)) as {
          id?: number;
          result?: { data?: string };
          error?: { message: string };
        };
        if (message.id === 1) {
          if (message.result?.data) {
            resolve(message.result.data);
          } else {
            reject(new Error(message.error?.message ?? 'no screenshot data'));
          }
        }
      });
      socket.send(
        JSON.stringify({ id: 1, method: 'Page.captureScreenshot', params: { format: 'png' } }),
      );
    });
    socket.close();
    mkdirSync(outDir, { recursive: true });
    const file = path.join(outDir, `${name}.png`);
    writeFileSync(file, Buffer.from(data, 'base64'));
    console.log(`[visual] saved ${file}`);
  } catch (error) {
    console.error(`[visual] screenshot ${name} failed`, error);
  }
}

(enabled ? describe : describe.skip)('visual harness', () => {
  let api: CodeTimeMachineApi;

  before(async function () {
    this.timeout(60_000);
    const extension = vscode.extensions.getExtension<CodeTimeMachineApi>('adtv.code-time-machine');
    if (!extension) {
      throw new Error('extension not found');
    }
    api = await extension.activate();
  });

  it('captures the deck for the demo file', async function () {
    this.timeout(180_000);
    const demo = vscode.workspace.workspaceFolders?.find((f) => f.name === 'demo');
    if (!demo) {
      throw new Error('demo folder missing');
    }
    const uri = vscode.Uri.joinPath(demo.uri, 'src', 'services', 'UserService.ts');
    // Focus on our UI: no sidebars, no text editors; the panel takes the whole editor area.
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await vscode.commands.executeCommand('workbench.action.closeSidebar');
    await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
    await vscode.commands.executeCommand('workbench.action.closePanel');
    await api.openFileHistory(uri);
    const started = Date.now();
    while (api.getSessionSnapshot(uri)?.status !== 'ready' && Date.now() - started < 30_000) {
      await sleep(50);
    }
    await api.waitForIdle(uri);
    await sleep(2500);
    await captureScreenshot('01-open');
    await vscode.commands.executeCommand('codeTimeMachine.previousRevision');
    await sleep(900);
    await captureScreenshot('02-older-1');
    await vscode.commands.executeCommand('codeTimeMachine.previousRevision');
    await vscode.commands.executeCommand('codeTimeMachine.previousRevision');
    await api.waitForIdle(uri);
    await sleep(900);
    await captureScreenshot('03-older-3');
    for (let i = 0; i < 9; i++) {
      await vscode.commands.executeCommand('codeTimeMachine.previousRevision');
    }
    await api.waitForIdle(uri);
    await sleep(900);
    await captureScreenshot('04-rename-area');
    const hold = Number(process.env['CTM_VISUAL_HOLD'] ?? '0');
    if (hold > 0) {
      await sleep(hold);
    }
  });
});
