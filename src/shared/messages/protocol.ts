/**
 * Typed protocol between the extension host and the webview. Every inbound message (webview →
 * extension) is validated at runtime by `parseWebviewMessage`; the webview validates messages
 * from the host structurally as well (see webview/state/messaging.ts).
 */
import type { DiffOp } from '../diff/lineDiff';
import type { LineMap } from '../mapping/lineMap';
import type { RevisionContent, RevisionMeta } from '../models/revision';

export type ThemeKind = 'light' | 'dark' | 'highContrast' | 'highContrastLight';

export type TimeTravelModifier = 'alt' | 'ctrl' | 'shift';

export interface WebviewConfig {
  animationDuration: number;
  showGhostLines: boolean;
  timeTravelModifier: TimeTravelModifier;
  preloadRevisions: number;
  maxRenderedLines: number;
}

/** A span of text with a colour index into the revision's palette (see HighlightedLines). */
export type Span = [text: string, colorIndex: number, fontStyle?: number];

export interface HighlightedLines {
  /** Colours referenced by spans, e.g. ['#d4d4d4', '#569cd6']. Index 0 is the default foreground. */
  palette: string[];
  lines: Span[][];
}

export interface DiffFromPrevious {
  /** Id of the older revision this view was diffed against. */
  previousId: string;
  ops: DiffOp[];
  /** Text of lines that exist in the previous revision but not in this one (for ghost rows). */
  deletedLines: string[];
  deletedHighlight?: HighlightedLines;
  /** Mapping previous (a) → this (b). */
  map: LineMap;
}

export interface RevisionView {
  id: string;
  content: RevisionContent;
  highlight?: HighlightedLines;
  diffFromPrevious?: DiffFromPrevious;
  /** True when highlighting/diffing was skipped because the file exceeds maxRenderedLines. */
  simplified: boolean;
}

export type EmptyStateKind =
  'notTracked' | 'noCommits' | 'notRepository' | 'gitDisabled' | 'gitNotFound' | 'binary' | 'error';

export interface EmptyState {
  kind: EmptyStateKind;
  message: string;
  detail?: string;
}

export interface InitPayload {
  fileName: string;
  relPath: string;
  repoName: string;
  languageId: string;
  theme: ThemeKind;
  config: WebviewConfig;
}

export interface HistoryPayload {
  revisions: RevisionMeta[];
  hasMore: boolean;
  loadingMore: boolean;
  activeIndex: number;
}

export type ExtensionToWebview =
  | { type: 'init'; payload: InitPayload }
  | { type: 'history'; payload: HistoryPayload }
  | { type: 'revision'; payload: RevisionView }
  | { type: 'revisionError'; payload: { id: string; code: string; message: string } }
  | { type: 'active'; payload: { index: number } }
  | { type: 'empty'; payload: EmptyState }
  | { type: 'config'; payload: WebviewConfig }
  | { type: 'theme'; payload: { theme: ThemeKind } }
  | { type: 'busy'; payload: { busy: boolean; message?: string } };

export type WebviewToExtension =
  | { type: 'ready' }
  | { type: 'setActive'; payload: { index: number } }
  | { type: 'loadMore' }
  | { type: 'refresh' }
  | { type: 'openRevision'; payload: { index: number } }
  | { type: 'compareWithWorkingTree'; payload: { index: number } }
  | { type: 'copy'; payload: { text: string; what: 'hash' | 'message' } }
  | { type: 'log'; payload: { level: 'debug' | 'info' | 'warn' | 'error'; message: string } };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isFiniteInt = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && Number.isFinite(value);

/** Validates an untrusted message coming from the webview. Returns undefined when invalid. */
export function parseWebviewMessage(raw: unknown): WebviewToExtension | undefined {
  if (!isRecord(raw) || typeof raw['type'] !== 'string') {
    return undefined;
  }
  const payload = raw['payload'];
  switch (raw['type']) {
    case 'ready':
    case 'loadMore':
    case 'refresh':
      return { type: raw['type'] };
    case 'setActive':
    case 'openRevision':
    case 'compareWithWorkingTree': {
      if (!isRecord(payload) || !isFiniteInt(payload['index']) || payload['index'] < 0) {
        return undefined;
      }
      return { type: raw['type'], payload: { index: payload['index'] } };
    }
    case 'copy': {
      if (
        !isRecord(payload) ||
        typeof payload['text'] !== 'string' ||
        payload['text'].length > 100_000 ||
        (payload['what'] !== 'hash' && payload['what'] !== 'message')
      ) {
        return undefined;
      }
      return { type: 'copy', payload: { text: payload['text'], what: payload['what'] } };
    }
    case 'log': {
      if (
        !isRecord(payload) ||
        typeof payload['message'] !== 'string' ||
        !['debug', 'info', 'warn', 'error'].includes(String(payload['level']))
      ) {
        return undefined;
      }
      return {
        type: 'log',
        payload: {
          level: payload['level'] as 'debug' | 'info' | 'warn' | 'error',
          message: payload['message'].slice(0, 2000),
        },
      };
    }
    default:
      return undefined;
  }
}

/** Light structural check for host → webview messages (defence in depth inside the webview). */
export function isExtensionMessage(raw: unknown): raw is ExtensionToWebview {
  if (!isRecord(raw) || typeof raw['type'] !== 'string') {
    return false;
  }
  return [
    'init',
    'history',
    'revision',
    'revisionError',
    'active',
    'empty',
    'config',
    'theme',
    'busy',
  ].includes(raw['type']);
}
