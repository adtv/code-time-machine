/**
 * Demo recorder: only runs when FTM_DEMO=1 (see .vscode-test.mjs, which also opens the DevTools
 * port and greps this suite so nothing else touches the window). It drives the real extension in
 * the demo repository and captures one PNG per storyboard beat plus a manifest of per-frame hold
 * times; `scripts/record-demo.mjs` turns those into media/demo.gif.
 *
 * This is a recorder, not a test: it asserts only what would make the recording meaningless.
 */
import * as assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as vscode from 'vscode';
import type { CodeTimeMachineApi } from '../../src/extension/extension';
import { WEBVIEW_DOC, connectWebview, connectWorkbench, type CdpSession } from './cdp';

const enabled = process.env['FTM_DEMO'] === '1';
const cdpPort = process.env['FTM_CDP_PORT'] ?? '9333';
const outDir = process.env['FTM_DEMO_DIR'] ?? path.join(process.cwd(), '.vscode-test', 'demo');
const width = Number(process.env['FTM_DEMO_WIDTH'] ?? '1280');
const height = Number(process.env['FTM_DEMO_HEIGHT'] ?? '820');
// Captured at 2x and downscaled by ffmpeg: text stays crisp in the GIF.
const captureScale = Number(process.env['FTM_DEMO_SCALE'] ?? '2');

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface Frame {
  file: string;
  /** Seconds this frame stays on screen in the GIF. */
  hold: number;
  beat: string;
}

(enabled ? describe : describe.skip)('demo recording', () => {
  it('captures the storyboard frames', async function () {
    this.timeout(600_000);
    const extension = vscode.extensions.getExtension<CodeTimeMachineApi>('adtv.file-time-machine');
    assert.ok(extension, 'extension not found');
    const api = await extension.activate();

    const demo = vscode.workspace.workspaceFolders?.find((f) => f.name === 'demo');
    assert.ok(demo, 'demo folder missing');
    const uri = vscode.Uri.joinPath(demo.uri, 'src', 'services', 'UserService.ts');

    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await vscode.commands.executeCommand('workbench.action.closeSidebar');
    await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
    await vscode.commands.executeCommand('workbench.action.closePanel');
    await sleep(500);

    const workbench = await connectWorkbench(cdpPort);
    await workbench.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await sleep(800);

    await api.openFileHistory(uri);
    const started = Date.now();
    while (api.getSessionSnapshot(uri)?.status !== 'ready' && Date.now() - started < 30_000) {
      await sleep(50);
    }
    await api.waitForIdle(uri);
    await sleep(2000);

    const webview: CdpSession = await connectWebview(
      cdpPort,
      'adtv.file-time-machine',
      `(() => { const doc = ${WEBVIEW_DOC}; const name = doc.querySelector('.ftm-toolbar-name'); return !!name && name.textContent === 'UserService.ts' && !!doc.querySelector('.ftm-card[data-slot="0"]'); })()`,
    );

    // Crop rectangle: the editor part only, so the recording shows the extension and not the
    // chrome around it. Measured live because it depends on the emulated window size.
    const clip = JSON.parse(
      await workbench.evaluate<string>(
        `(() => { const el = document.querySelector('.part.editor'); const r = el.getBoundingClientRect(); const even = (n) => Math.round(n / 2) * 2; return JSON.stringify({ x: even(r.left), y: even(r.top), width: even(r.width), height: even(r.height) }); })()`,
      ),
    ) as { x: number; y: number; width: number; height: number };
    console.log(`[demo] clip ${JSON.stringify(clip)}`);
    assert.ok(clip.width > 600 && clip.height > 400, 'editor area large enough to record');

    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });
    const frames: Frame[] = [];
    let beat = 'open';

    const frame = async (hold: number): Promise<void> => {
      const file = `frame-${String(frames.length).padStart(4, '0')}.png`;
      const { data } = await workbench.send<{ data: string }>('Page.captureScreenshot', {
        format: 'png',
        clip: { ...clip, scale: captureScale },
        captureBeyondViewport: false,
      });
      writeFileSync(path.join(outDir, file), Buffer.from(data, 'base64'));
      frames.push({ file, hold, beat });
    };

    const js = (expression: string): Promise<unknown> => webview.evaluate(expression);
    const inWebview = (body: string): string =>
      `(() => { const doc = ${WEBVIEW_DOC}; const W = doc.defaultView; ${body} })()`;
    const setScroll = (top: number | string): Promise<unknown> =>
      js(
        inWebview(
          `const code = doc.querySelector('.ftm-card[data-slot="0"] .ftm-code'); code.scrollTop = ${String(top)}; return code.scrollTop;`,
        ),
      );
    const key = (k: string): Promise<unknown> =>
      js(
        inWebview(
          `W.dispatchEvent(new W.KeyboardEvent('keydown', { key: '${k}', bubbles: true, cancelable: true })); return true;`,
        ),
      );
    const clickTimeline = async (index: number): Promise<void> => {
      const subject = await js(
        inWebview(
          `const item = doc.querySelector('.ftm-timeline-item[data-index="${String(index)}"]'); if (!item) return 'missing'; item.click(); return (item.textContent || '').trim().slice(0, 40);`,
        ),
      );
      console.log(`[demo] ${beat}: revision ${index} — ${String(subject)}`);
      assert.notEqual(subject, 'missing', `timeline item ${index} exists`);
    };
    /** Captures the transition itself: a few quick frames, then a hold on the settled state. */
    const settle = async (hold: number): Promise<void> => {
      await sleep(90);
      await frame(0.08);
      await sleep(120);
      await frame(0.08);
      await sleep(600);
      await frame(hold);
    };

    // 1 — the deck as it opens.
    await frame(2.2);

    // 2 — scrolling the active card drags the neighbours to the same logical lines.
    beat = 'scroll-sync';
    for (let top = 80; top <= 720; top += 80) {
      await setScroll(top);
      await sleep(110);
      await frame(0.1);
    }
    await frame(1.4);
    await setScroll(0);
    await sleep(350);
    await frame(0.8);

    // 3 — travelling back in time, one revision at a time.
    beat = 'time-travel';
    for (let i = 0; i < 3; i++) {
      await vscode.commands.executeCommand('fileTimeMachine.previousRevision');
      await settle(i === 2 ? 1.6 : 0.7);
    }
    await key('k');
    await settle(1.2);

    // 4 — jumping straight to a revision from the timeline.
    beat = 'timeline';
    await clickTimeline(8);
    await settle(1.8);

    // 5 — change blocks: N walks the diff, the footer counts k/n.
    beat = 'change-nav';
    await clickTimeline(2);
    await settle(1.2);
    for (let i = 0; i < 3; i++) {
      await key('n');
      await sleep(420);
      await frame(1.2);
    }

    // 6 — ghost lines: a revision that removes code keeps it visible, struck through.
    beat = 'ghost-lines';
    await clickTimeline(6);
    await settle(1.0);
    await key('n');
    await sleep(450);
    await frame(2.0);

    // 7 — history crosses the rename: the header shows the old path.
    // (index logged below; if it stops pointing at the rename, adjust FTM_DEMO_RENAME_INDEX)
    beat = 'rename';
    const renameIndex = Number(process.env['FTM_DEMO_RENAME_INDEX'] ?? '13');
    await clickTimeline(renameIndex);
    await api.waitForIdle(uri);
    await settle(2.2);

    // 8 — back to the working tree; the minimap drags the code.
    beat = 'minimap';
    await clickTimeline(0);
    await settle(1.0);
    const minimapDrag = await js(
      inWebview(
        `const canvas = doc.querySelector('.ftm-card[data-slot="0"] .ftm-minimap'); if (!canvas) return 'no-minimap'; const r = canvas.getBoundingClientRect(); canvas.dispatchEvent(new W.MouseEvent('mousedown', { clientX: r.left + r.width / 2, clientY: r.top + r.height * 0.2, button: 0, bubbles: true })); return 'down';`,
      ),
    );
    console.log(`[demo] minimap ${String(minimapDrag)}`);
    for (const fraction of [0.35, 0.5, 0.65, 0.8]) {
      await js(
        inWebview(
          `const canvas = doc.querySelector('.ftm-card[data-slot="0"] .ftm-minimap'); const r = canvas.getBoundingClientRect(); W.dispatchEvent(new W.MouseEvent('mousemove', { clientX: r.left + r.width / 2, clientY: r.top + r.height * ${String(fraction)}, buttons: 1, bubbles: true })); return true;`,
        ),
      );
      await sleep(140);
      await frame(0.16);
    }
    await js(
      inWebview(`W.dispatchEvent(new W.MouseEvent('mouseup', { bubbles: true })); return true;`),
    );
    await sleep(300);
    await frame(2.4);

    writeFileSync(
      path.join(outDir, 'frames.json'),
      `${JSON.stringify({ clip, width, height, captureScale, frames }, null, 2)}\n`,
    );
    console.log(`[demo] captured ${frames.length} frames in ${outDir}`);
    const total = frames.reduce((sum, f) => sum + f.hold, 0);
    console.log(`[demo] storyboard length ${total.toFixed(1)}s`);
    assert.ok(frames.length >= 30, 'enough frames for a recording');

    await workbench.send('Emulation.clearDeviceMetricsOverride');
    webview.close();
    workbench.close();
  });
});
