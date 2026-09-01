/**
 * Visual harness: only runs when CTM_VISUAL=1. Opens the demo file's history in the real VS Code
 * window, captures screenshots through the Chromium DevTools Protocol and inspects the live
 * webview DOM (VS Code is launched with --remote-debugging-port, see .vscode-test.mjs).
 * Skipped in CI.
 */
import * as assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as vscode from 'vscode';
import type { CodeTimeMachineApi } from '../../src/extension/extension';
import { WEBVIEW_DOC, connectWebview, connectWorkbench, listTargets, type CdpSession } from './cdp';

const enabled = process.env['CTM_VISUAL'] === '1';
const cdpPort = process.env['CTM_CDP_PORT'] ?? '9333';
const outDir = process.env['CTM_SHOT_DIR'] ?? path.join(process.cwd(), '.vscode-test', 'shots');

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function shot(name: string): Promise<void> {
  try {
    const workbench = await connectWorkbench(cdpPort);
    const png = await workbench.screenshot();
    workbench.close();
    mkdirSync(outDir, { recursive: true });
    writeFileSync(path.join(outDir, `${name}.png`), png);
    console.log(`[visual] saved ${name}.png`);
  } catch (error) {
    console.error(`[visual] screenshot ${name} failed`, error);
  }
}

interface CardInfo {
  slot: string;
  rect: { top: number; bottom: number; left: number; right: number; height: number };
  header: { top: number; bottom: number };
  footer: { top: number; bottom: number; display: string };
  scrollTop: number;
  centerText: string | null;
  approx: boolean;
}

const CARDS_SCRIPT = `(() => {
  const doc = ${WEBVIEW_DOC};
  const rowHeight = 20;
  return [...doc.querySelectorAll('.ctm-card')].map((card) => {
    const rect = card.getBoundingClientRect();
    const header = card.querySelector('.ctm-card-header').getBoundingClientRect();
    const footerEl = card.querySelector('.ctm-card-footer');
    const footer = footerEl.getBoundingClientRect();
    const code = card.querySelector('.ctm-code');
    let centerText = null;
    let scrollTop = -1;
    if (code) {
      scrollTop = code.scrollTop;
      const centerY = code.scrollTop + code.clientHeight / 2;
      const rowIndex = Math.floor(centerY / rowHeight);
      for (const row of code.querySelectorAll('.ctm-row')) {
        const m = /translateY\\((\\d+)px\\)/.exec(row.style.transform);
        if (m && Number(m[1]) === rowIndex * rowHeight) {
          centerText = row.querySelector('.ctm-gutter').textContent + ': ' + row.querySelector('.ctm-text').textContent;
        }
      }
    }
    return {
      slot: card.dataset.slot,
      rect: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, height: rect.height },
      header: { top: header.top, bottom: header.bottom },
      footer: { top: footer.top, bottom: footer.bottom, display: getComputedStyle(footerEl).display },
      scrollTop,
      centerText,
      approx: code ? code.classList.contains('ctm-code-approximate') : false,
    };
  });
})()`;

(enabled ? describe : describe.skip)('visual harness', () => {
  let api: CodeTimeMachineApi;
  let webview: CdpSession | undefined;

  before(async function () {
    this.timeout(60_000);
    const extension = vscode.extensions.getExtension<CodeTimeMachineApi>('adtv.code-time-machine');
    if (!extension) {
      throw new Error('extension not found');
    }
    api = await extension.activate();
  });

  after(() => webview?.close());

  it('captures the deck and verifies scroll synchronisation in the live webview', async function () {
    this.timeout(180_000);
    const demo = vscode.workspace.workspaceFolders?.find((f) => f.name === 'demo');
    if (!demo) {
      throw new Error('demo folder missing');
    }
    const uri = vscode.Uri.joinPath(demo.uri, 'src', 'services', 'UserService.ts');
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
    await shot('01-open');

    const targets = await listTargets(cdpPort);
    console.log(
      '[visual] targets:',
      targets.map((t) => `${t.type} ${t.url.slice(0, 90)}`).join('\n  '),
    );
    webview = await connectWebview(
      cdpPort,
      'adtv.code-time-machine',
      `(() => { const doc = ${WEBVIEW_DOC}; const name = doc.querySelector('.ctm-toolbar-name'); return !!name && name.textContent === 'UserService.ts' && !!doc.querySelector('.ctm-card[data-slot="0"]'); })()`,
    );
    const cards = await webview.evaluate<CardInfo[]>(CARDS_SCRIPT);
    console.log('[visual] cards:', JSON.stringify(cards, null, 1));
    const active = cards.find((c) => c.slot === '0');
    const older = cards.find((c) => c.slot === '1');
    assert.ok(active && older, 'active and older cards present');
    // The older card's footer must be the part that peeks below the active card.
    console.log(
      `[visual] active bottom ${active.rect.bottom.toFixed(1)}, older footer top ${older.footer.top.toFixed(1)} bottom ${older.footer.bottom.toFixed(1)}`,
    );

    // Scroll the active card by ~600px and check the neighbours re-centre on the mapped line.
    await webview.evaluate(
      `(() => { const doc = ${WEBVIEW_DOC}; const code = doc.querySelector('.ctm-card[data-slot="0"] .ctm-code'); code.scrollTop = 600; return code.scrollTop; })()`,
    );
    await sleep(400);
    const afterScroll = await webview.evaluate<CardInfo[]>(CARDS_SCRIPT);
    for (const card of afterScroll) {
      console.log(
        `[visual] slot ${card.slot}: scrollTop ${card.scrollTop} center "${card.centerText}" approx=${card.approx}`,
      );
    }
    await shot('02-scrolled');
    const activeAfter = afterScroll.find((c) => c.slot === '0');
    const olderAfter = afterScroll.find((c) => c.slot === '1');
    assert.ok(activeAfter && olderAfter);
    assert.ok(activeAfter.scrollTop >= 590, 'active card scrolled');
    assert.ok(olderAfter.scrollTop > 0, 'older card followed the active card');

    await vscode.commands.executeCommand('codeTimeMachine.previousRevision');
    await sleep(900);
    await shot('03-older-1');

    // Alt + wheel (dispatched inside the webview) must travel one revision older.
    const before = api.getSessionSnapshot(uri)?.activeIndex ?? -1;
    await webview.evaluate(
      `(() => { const doc = ${WEBVIEW_DOC}; const deck = doc.querySelector('.ctm-deck'); const W = doc.defaultView; deck.dispatchEvent(new W.WheelEvent('wheel', { deltaY: 120, deltaMode: 0, altKey: true, bubbles: true, cancelable: true })); return true; })()`,
    );
    await sleep(700);
    assert.equal(
      api.getSessionSnapshot(uri)?.activeIndex,
      before + 1,
      'Alt+wheel moved to the older revision',
    );
    // Keyboard: K goes back to the newer revision.
    await webview.evaluate(
      `(() => { const doc = ${WEBVIEW_DOC}; const W = doc.defaultView; W.dispatchEvent(new W.KeyboardEvent('keydown', { key: 'k', bubbles: true, cancelable: true })); return true; })()`,
    );
    await sleep(700);
    assert.equal(api.getSessionSnapshot(uri)?.activeIndex, before, 'K moved to the newer revision');
    // Timeline click selects a revision directly.
    await webview.evaluate(
      `(() => { const doc = ${WEBVIEW_DOC}; doc.querySelector('.ctm-timeline-item[data-index="5"]').click(); return true; })()`,
    );
    await sleep(700);
    assert.equal(api.getSessionSnapshot(uri)?.activeIndex, 5, 'timeline click selected revision 5');
    await shot('03b-timeline-click');
    const afterNav = await webview.evaluate<CardInfo[]>(CARDS_SCRIPT);
    for (const card of afterNav) {
      console.log(
        `[visual] after nav slot ${card.slot}: scrollTop ${card.scrollTop} center "${card.centerText}"`,
      );
    }
    for (let i = 0; i < 11; i++) {
      await vscode.commands.executeCommand('codeTimeMachine.previousRevision');
    }
    await api.waitForIdle(uri);
    await sleep(900);
    await shot('04-rename-area');
    const hold = Number(process.env['CTM_VISUAL_HOLD'] ?? '0');
    if (hold > 0) {
      await sleep(hold);
    }
  });
});
