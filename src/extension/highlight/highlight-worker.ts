/**
 * Worker-thread entry: tokenises code with Shiki off the extension host's main thread.
 * Built to dist/highlight-worker.js by esbuild (see esbuild.mjs).
 */
import { parentPort } from 'node:worker_threads';
import { HighlightCore } from './highlightCore';
import type { HighlightRequest, HighlightResponse } from './highlightProtocol';

const core = new HighlightCore();
const port = parentPort;

if (port) {
  port.on('message', (request: HighlightRequest) => {
    core
      .highlight(request.lines, request.languageId, request.theme, request.fileName)
      .then((result) => {
        const response: HighlightResponse = { id: request.id, result };
        port.postMessage(response);
      })
      .catch((error: unknown) => {
        const response: HighlightResponse = {
          id: request.id,
          error: error instanceof Error ? error.message : String(error),
        };
        port.postMessage(response);
      });
  });
}
