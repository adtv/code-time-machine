import {
  isExtensionMessage,
  type ExtensionToWebview,
  type WebviewToExtension,
} from '../../shared/messages/protocol';

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

let api: VsCodeApi | undefined;

function getApi(): VsCodeApi | undefined {
  if (api) {
    return api;
  }
  try {
    api = acquireVsCodeApi();
  } catch {
    api = undefined; // running outside VS Code (tests)
  }
  return api;
}

export function postToExtension(message: WebviewToExtension): void {
  getApi()?.postMessage(message);
}

export function onExtensionMessage(handler: (message: ExtensionToWebview) => void): () => void {
  const listener = (event: MessageEvent<unknown>): void => {
    if (isExtensionMessage(event.data)) {
      handler(event.data);
    }
  };
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}
