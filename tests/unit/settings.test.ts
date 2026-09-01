import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  nextHistoryPageSize,
  readSettings,
  toWebviewConfig,
  type SettingsReader,
} from '../../src/extension/config/settings';

const reader = (values: Record<string, unknown>): SettingsReader => ({
  get: <T>(key: string) => values[key] as T | undefined,
});

describe('readSettings', () => {
  it('applies defaults when nothing is configured', () => {
    expect(readSettings(reader({}))).toEqual(DEFAULT_SETTINGS);
  });

  it('clamps and validates values', () => {
    const s = readSettings(
      reader({
        maxCommits: 5,
        preloadRevisions: 99,
        animationDuration: -10,
        showGhostLines: 'yes',
        maxFileSizeKB: 1,
        timeTravelModifier: 'meta',
        maxRenderedLines: 10,
      }),
    );
    expect(s.maxCommits).toBe(10);
    expect(s.preloadRevisions).toBe(8);
    expect(s.animationDuration).toBe(0);
    expect(s.showGhostLines).toBe(true);
    expect(s.maxFileSizeBytes).toBe(64 * 1024);
    expect(s.timeTravelModifier).toBe('alt');
    expect(s.maxRenderedLines).toBe(500);
  });

  it('accepts valid explicit values', () => {
    const s = readSettings(
      reader({ timeTravelModifier: 'ctrl', followRenames: false, ignoreWhitespace: true }),
    );
    expect(s.timeTravelModifier).toBe('ctrl');
    expect(s.followRenames).toBe(false);
    expect(s.ignoreWhitespace).toBe(true);
    expect(toWebviewConfig(s)).toEqual({
      animationDuration: 200,
      showGhostLines: true,
      timeTravelModifier: 'ctrl',
      preloadRevisions: 3,
      maxRenderedLines: 8000,
    });
  });
});

describe('nextHistoryPageSize', () => {
  it('grows geometrically and respects the cap', () => {
    expect(nextHistoryPageSize(0, 500)).toBe(100);
    expect(nextHistoryPageSize(100, 500)).toBe(300);
    expect(nextHistoryPageSize(300, 500)).toBe(500);
    expect(nextHistoryPageSize(500, 500)).toBe(500);
    expect(nextHistoryPageSize(0, 50)).toBe(50);
    expect(nextHistoryPageSize(3000, 10_000)).toBe(5000);
  });
});
