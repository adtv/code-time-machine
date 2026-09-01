import * as vscode from 'vscode';
import {
  parseWebviewMessage,
  type ExtensionToWebview,
  type WebviewToExtension,
} from '../../shared/messages/protocol';
import type { Logger } from '../logging/logger';

export const HISTORY_VIEW_TYPE = 'fileTimeMachine.history';

/**
 * Owns one WebviewPanel: HTML with a strict CSP, message validation, and an outbound queue that
 * buffers messages until the webview reports `ready` (so nothing is lost while it boots).
 */
export class HistoryPanel implements vscode.Disposable {
  readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly disposeEmitter = new vscode.EventEmitter<void>();
  private readonly messageEmitter = new vscode.EventEmitter<WebviewToExtension>();
  private readonly queue: ExtensionToWebview[] = [];
  private ready = false;
  private disposed = false;

  readonly onDidDispose = this.disposeEmitter.event;
  readonly onDidReceiveMessage = this.messageEmitter.event;

  constructor(
    private readonly extensionUri: vscode.Uri,
    title: string,
    private readonly logger: Logger,
    viewColumn: vscode.ViewColumn = vscode.ViewColumn.Beside,
  ) {
    this.panel = vscode.window.createWebviewPanel(HISTORY_VIEW_TYPE, title, viewColumn, {
      enableScripts: true,
      enableForms: false,
      // The deck holds several rendered revisions; rebuilding it on every tab switch would
      // re-fetch and re-render everything, so we keep the context alive.
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist', 'webview')],
    });
    this.panel.webview.html = this.renderHtml(title);
    this.disposables.push(
      this.panel.onDidDispose(() => this.dispose()),
      this.panel.webview.onDidReceiveMessage((raw: unknown) => {
        const message = parseWebviewMessage(raw);
        if (!message) {
          this.logger.warn('ignored invalid webview message', raw);
          return;
        }
        if (message.type === 'ready') {
          this.ready = true;
          for (const queued of this.queue.splice(0)) {
            void this.panel.webview.postMessage(queued);
          }
        }
        this.messageEmitter.fire(message);
      }),
    );
  }

  get visible(): boolean {
    return this.panel.visible;
  }

  get active(): boolean {
    return this.panel.active;
  }

  post(message: ExtensionToWebview): void {
    if (this.disposed) {
      return;
    }
    if (!this.ready) {
      this.queue.push(message);
      return;
    }
    void this.panel.webview.postMessage(message);
  }

  reveal(): void {
    this.panel.reveal(undefined, false);
  }

  setTitle(title: string): void {
    this.panel.title = title;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const d of this.disposables.splice(0)) {
      d.dispose();
    }
    this.disposeEmitter.fire();
    this.disposeEmitter.dispose();
    this.messageEmitter.dispose();
    this.panel.dispose();
  }

  private renderHtml(title: string): string {
    const webview = this.panel.webview;
    const nonce = createNonce();
    const asset = (...segments: string[]): string =>
      webview
        .asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', ...segments))
        .toString();
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource} 'nonce-${nonce}'`,
      `font-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
      `img-src ${webview.cspSource} data:`,
    ].join('; ');
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${asset('codicons', 'codicon.css')}" nonce="${nonce}" />
  <link rel="stylesheet" href="${asset('main.css')}" nonce="${nonce}" />
  <title>${escapeHtml(title)}</title>
</head>
<body>
  <div id="root" role="application" aria-label="File Time Machine"></div>
  <script nonce="${nonce}" src="${asset('main.js')}"></script>
</body>
</html>`;
  }
}

function createNonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i++) {
    out += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return out;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;');
}
