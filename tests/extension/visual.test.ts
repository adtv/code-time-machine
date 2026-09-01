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
    const inspected = vscode.workspace.getConfiguration('workbench').inspect('colorTheme');
    console.log(
      `[visual] theme setting: ${String(vscode.workspace.getConfiguration('workbench').get('colorTheme'))} (global ${String(inspected?.globalValue)}, workspace ${String(inspected?.workspaceValue)}), kind: ${vscode.window.activeColorTheme.kind}, autoDetectHC: ${String(vscode.workspace.getConfiguration('window').get('autoDetectHighContrast'))}`,
    );
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

    // Minimap: present on the active card only; clicking near its bottom scrolls the code.
    // Use the working-tree revision (68 lines) so the code area is actually scrollable.
    await webview.evaluate(
      `(() => { const doc = ${WEBVIEW_DOC}; doc.querySelector('.ctm-timeline-item[data-index="0"]').click(); return true; })()`,
    );
    await sleep(900);
    await shot('04b-minimap');
    const minimapInfo = await webview.evaluate<string>(
      `(() => { const doc = ${WEBVIEW_DOC}; const active = doc.querySelector('.ctm-card[data-slot="0"]'); const canvas = active.querySelector('.ctm-minimap'); const others = doc.querySelectorAll('.ctm-card:not([data-slot="0"]) .ctm-minimap').length; if (!canvas) return JSON.stringify({ canvas: false, others }); const r = canvas.getBoundingClientRect(); const code = active.querySelector('.ctm-code'); const before = code.scrollTop; const W = doc.defaultView; canvas.dispatchEvent(new W.MouseEvent('mousedown', { clientX: r.left + 10, clientY: r.bottom - 5, button: 0, bubbles: true })); W.dispatchEvent(new W.MouseEvent('mouseup', { bubbles: true })); return JSON.stringify({ canvas: true, width: r.width, height: r.height, others, rows: code.querySelectorAll('.ctm-row').length, scrollHeight: code.scrollHeight, clientHeight: code.clientHeight, before, after: code.scrollTop }); })()`,
    );
    console.log(`[visual] minimap: ${minimapInfo}`);
    const parsedMinimap = JSON.parse(minimapInfo) as {
      canvas: boolean;
      others: number;
      before?: number;
      after?: number;
    };
    assert.equal(parsedMinimap.canvas, true, 'active card has a minimap');
    assert.equal(parsedMinimap.others, 0, 'background cards have no minimap');
    assert.ok(
      (parsedMinimap.after ?? 0) > (parsedMinimap.before ?? 0),
      'clicking the minimap scrolled the code',
    );
    await sleep(400);
    await shot('04c-minimap-clicked');

    // Responsive check: emulate narrow windows and capture the deck + timeline.
    const workbench = await connectWorkbench(cdpPort);
    try {
      for (const [name, width] of [
        ['05-narrow', 620],
        ['06-very-narrow', 420],
      ] as const) {
        await workbench.send('Emulation.setDeviceMetricsOverride', {
          width,
          height: 900,
          deviceScaleFactor: 1,
          mobile: false,
        });
        await sleep(1200);
        const cards = await webview.evaluate<CardInfo[]>(CARDS_SCRIPT);
        const active = cards.find((c) => c.slot === '0');
        console.log(
          `[visual] ${name}: card ${active ? (active.rect.right - active.rect.left).toFixed(0) : '?'}px wide, header ${active ? (active.header.bottom - active.header.top).toFixed(1) : '?'}px tall`,
        );
        writeFileSync(path.join(outDir, `${name}.png`), await workbench.screenshot());
        console.log(`[visual] saved ${name}.png`);
      }
      await workbench.send('Emulation.clearDeviceMetricsOverride');
      await sleep(800);
      // Sticky day headers must paint above the dots: scroll the list so items pass under one.
      await webview.evaluate(
        `(() => { const doc = ${WEBVIEW_DOC}; const list = doc.querySelector('.ctm-timeline-list'); list.scrollTop = 130; return list.scrollTop; })()`,
      );
      await sleep(400);
      const sticky = await webview.evaluate<string>(
        `(() => { const doc = ${WEBVIEW_DOC}; const list = doc.querySelector('.ctm-timeline-list'); const lr = list.getBoundingClientRect(); const days = [...doc.querySelectorAll('.ctm-timeline-day')]; const items = [...doc.querySelectorAll('.ctm-timeline-item')]; const near = (el) => { const r = el.getBoundingClientRect(); return { top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1), z: getComputedStyle(el).zIndex, pos: getComputedStyle(el).position, text: (el.textContent || '').trim().slice(0, 28) }; }; return JSON.stringify({ list: { top: +lr.top.toFixed(1), padTop: getComputedStyle(list).paddingTop }, days: days.slice(0, 3).map(near), items: items.slice(0, 4).map(near) }); })()`,
      );
      console.log(`[visual] sticky geometry: ${sticky}`);
      writeFileSync(path.join(outDir, '07-timeline-scrolled.png'), await workbench.screenshot());
      console.log('[visual] saved 07-timeline-scrolled.png');
    } finally {
      workbench.close();
    }
    const hold = Number(process.env['CTM_VISUAL_HOLD'] ?? '0');
    if (hold > 0) {
      await sleep(hold);
    }
  });
});
