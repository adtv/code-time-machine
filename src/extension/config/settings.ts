import type { TimeTravelModifier, WebviewConfig } from '../../shared/messages/protocol';

/** All extension settings, validated and with defaults applied. */
export interface Settings {
  maxCommits: number;
  preloadRevisions: number;
  animationDuration: number;
  showGhostLines: boolean;
  followRenames: boolean;
  ignoreWhitespace: boolean;
  maxFileSizeBytes: number;
  maxRenderedLines: number;
  timeTravelModifier: TimeTravelModifier;
}

export const DEFAULT_SETTINGS: Settings = {
  maxCommits: 500,
  preloadRevisions: 3,
  animationDuration: 200,
  showGhostLines: true,
  followRenames: true,
  ignoreWhitespace: false,
  maxFileSizeBytes: 2048 * 1024,
  maxRenderedLines: 8000,
  timeTravelModifier: 'alt',
};

/** Minimal reader abstraction so settings can be built without the vscode module in tests. */
export interface SettingsReader {
  get<T>(key: string): T | undefined;
}

const clampInt = (value: unknown, fallback: number, min: number, max: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
};

export function readSettings(reader: SettingsReader): Settings {
  const bool = (key: string, fallback: boolean): boolean => {
    const v = reader.get<unknown>(key);
    return typeof v === 'boolean' ? v : fallback;
  };
  const modifier = reader.get<unknown>('timeTravelModifier');
  return {
    maxCommits: clampInt(reader.get('maxCommits'), DEFAULT_SETTINGS.maxCommits, 10, 10_000),
    preloadRevisions: clampInt(
      reader.get('preloadRevisions'),
      DEFAULT_SETTINGS.preloadRevisions,
      1,
      8,
    ),
    animationDuration: clampInt(
      reader.get('animationDuration'),
      DEFAULT_SETTINGS.animationDuration,
      0,
      1000,
    ),
    showGhostLines: bool('showGhostLines', DEFAULT_SETTINGS.showGhostLines),
    followRenames: bool('followRenames', DEFAULT_SETTINGS.followRenames),
    ignoreWhitespace: bool('ignoreWhitespace', DEFAULT_SETTINGS.ignoreWhitespace),
    maxFileSizeBytes: clampInt(reader.get('maxFileSizeKB'), 2048, 64, 1_048_576) * 1024,
    maxRenderedLines: clampInt(
      reader.get('maxRenderedLines'),
      DEFAULT_SETTINGS.maxRenderedLines,
      500,
      1_000_000,
    ),
    timeTravelModifier:
      modifier === 'alt' || modifier === 'ctrl' || modifier === 'shift'
        ? modifier
        : DEFAULT_SETTINGS.timeTravelModifier,
  };
}

export function toWebviewConfig(settings: Settings): WebviewConfig {
  return {
    animationDuration: settings.animationDuration,
    showGhostLines: settings.showGhostLines,
    timeTravelModifier: settings.timeTravelModifier,
    preloadRevisions: settings.preloadRevisions,
    maxRenderedLines: settings.maxRenderedLines,
  };
}

/** Page sizes grow geometrically because history is re-walked with a larger -n (see docs). */
export function nextHistoryPageSize(loaded: number, maxCommits: number): number {
  const next = loaded === 0 ? 100 : Math.min(loaded * 2, 2000);
  return Math.min(maxCommits, loaded + next);
}
