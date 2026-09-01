/**
 * Minimal Chrome DevTools Protocol client used by the visual harness (Node ≥ 22: global fetch
 * and WebSocket). VS Code must be launched with --remote-debugging-port.
 */
export interface CdpTarget {
  id: string;
  type: string;
  url: string;
  title: string;
  webSocketDebuggerUrl: string;
}

export async function listTargets(port: string): Promise<CdpTarget[]> {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  return (await response.json()) as CdpTarget[];
}

export class CdpSession {
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as {
        id?: number;
        result?: unknown;
        error?: { message: string };
      };
      if (message.id === undefined) {
        return;
      }
      const waiter = this.pending.get(message.id);
      if (!waiter) {
        return;
      }
      this.pending.delete(message.id);
      if (message.error) {
        waiter.reject(new Error(message.error.message));
      } else {
        waiter.resolve(message.result);
      }
    });
  }

  static async connect(target: CdpTarget): Promise<CdpSession> {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve());
      socket.addEventListener('error', () => reject(new Error(`cannot connect to ${target.url}`)));
    });
    return new CdpSession(socket);
  }

  send<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  /** Evaluates an expression and returns its JSON value. */
  async evaluate<T = unknown>(expression: string): Promise<T> {
    const result = await this.send<{
      result: { value?: T; description?: string; type: string };
      exceptionDetails?: { text: string; exception?: { description?: string } };
    }>('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description ?? result.exceptionDetails.text,
      );
    }
    return result.result.value as T;
  }

  async screenshot(): Promise<Buffer> {
    const { data } = await this.send<{ data: string }>('Page.captureScreenshot', {
      format: 'png',
    });
    return Buffer.from(data, 'base64');
  }

  close(): void {
    this.socket.close();
  }
}

/** Connects to the VS Code workbench window. */
export async function connectWorkbench(port: string): Promise<CdpSession> {
  const targets = await listTargets(port);
  const page = targets.find((t) => t.type === 'page' && t.url.includes('workbench.html'));
  if (!page) {
    throw new Error(`workbench target not found among: ${targets.map((t) => t.url).join(', ')}`);
  }
  return CdpSession.connect(page);
}

/**
 * Connects to our webview's frame. VS Code hosts webviews in an out-of-process iframe whose URL
 * carries `extensionId=<publisher.name>`; inside it, the content lives in an iframe with id
 * "active-frame".
 */
export async function connectWebview(port: string, extensionId: string): Promise<CdpSession> {
  const targets = await listTargets(port);
  const frame = targets.find(
    (t) => t.type === 'iframe' && t.url.includes(`extensionId=${extensionId}`),
  );
  if (!frame) {
    throw new Error(
      `webview target not found among: ${targets.map((t) => `${t.type}:${t.url}`).join(' | ')}`,
    );
  }
  return CdpSession.connect(frame);
}

/** JS prelude that resolves the document of our webview content (inner frame if present). */
export const WEBVIEW_DOC =
  "(() => { const inner = document.getElementById('active-frame'); return inner && inner.contentDocument ? inner.contentDocument : document; })()";
