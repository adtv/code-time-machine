import type { CodeView } from './codeView';

/** Live CodeView instances by revision id (cards currently in the DOM). */
const codeViews = new Map<string, CodeView>();
const listeners = new Set<(id: string) => void>();

export function registerCodeView(id: string, view: CodeView): () => void {
  codeViews.set(id, view);
  for (const listener of listeners) {
    listener(id);
  }
  return () => {
    if (codeViews.get(id) === view) {
      codeViews.delete(id);
    }
  };
}

export function getCodeView(id: string): CodeView | undefined {
  return codeViews.get(id);
}

/** Notified when a code view is (re)registered or its model changes. */
export function onCodeViewReady(listener: (id: string) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifyCodeViewReady(id: string): void {
  for (const listener of listeners) {
    listener(id);
  }
}
