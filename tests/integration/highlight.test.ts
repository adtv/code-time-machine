import { describe, expect, it } from 'vitest';
import { HighlightCore } from '../../src/extension/highlight/highlightCore';
import { hashLines } from '../../src/extension/highlight/highlightService';

const core = new HighlightCore();

describe('HighlightCore (Shiki, JavaScript regex engine)', () => {
  it('tokenises TypeScript into spans with a palette', async () => {
    const lines = ['export class Foo {', '  // comment', "  name = 'x';", '}'];
    const result = await core.highlight(lines, 'typescript', 'dark');
    expect(result).toBeDefined();
    expect(result?.lines).toHaveLength(4);
    expect(result?.palette.length).toBeGreaterThan(2);
    expect(result?.palette[0]).toMatch(/^#/u);
    // Every line reconstructs its text from the spans.
    result?.lines.forEach((spans, i) => {
      expect(spans.map((s) => s[0]).join('')).toBe(lines[i]);
    });
    const keyword = result?.lines[0]?.[0];
    expect(keyword?.[0]).toBe('export');
    expect(keyword?.[1]).toBeGreaterThan(0);
  }, 30_000);

  it('highlights PHP, Python and JSON, and returns undefined for unknown languages', async () => {
    const php = await core.highlight(['<?php', 'echo strlen("abc");'], 'php', 'light');
    expect(php?.lines[1]?.length).toBeGreaterThan(1);
    const py = await core.highlight(['def f(x):', '    return x + 1'], 'python', 'dark', 'f.py');
    expect(py?.lines[0]?.some((s) => s[0] === 'def')).toBe(true);
    const json = await core.highlight(['{ "a": 1 }'], 'plaintext', 'dark', 'settings.json');
    expect(json?.lines[0]?.length).toBeGreaterThan(1);
    expect(await core.highlight(['plain'], 'plaintext', 'dark', 'notes.txt')).toBeUndefined();
    expect(await core.highlight([], 'typescript', 'dark')).toEqual({
      palette: [expect.stringMatching(/^#/u) as unknown as string],
      lines: [],
    });
  }, 30_000);

  it('uses different palettes for dark and light themes', async () => {
    const dark = await core.highlight(['const a = 1;'], 'typescript', 'dark');
    const light = await core.highlight(['const a = 1;'], 'typescript', 'light');
    expect(dark?.palette[0]).not.toBe(light?.palette[0]);
  });

  it('keeps multi-line constructs consistent (block comment spans lines)', async () => {
    const result = await core.highlight(
      ['/* start', 'middle', 'end */ const x = 1;'],
      'typescript',
      'dark',
    );
    const commentColor = result?.lines[0]?.[0]?.[1];
    expect(result?.lines[1]?.[0]?.[1]).toBe(commentColor);
  });

  it('tokenises a 3000-line file in a reasonable time', async () => {
    const lines = Array.from({ length: 3000 }, (_, i) =>
      i % 3 === 0
        ? `function f${i}(a: number): number {`
        : i % 3 === 1
          ? `  return a * ${i}; // note`
          : '}',
    );
    await core.highlight(lines.slice(0, 10), 'typescript', 'dark'); // warm-up
    const started = performance.now();
    const result = await core.highlight(lines, 'typescript', 'dark');
    const elapsed = performance.now() - started;
    expect(result?.lines).toHaveLength(3000);
    console.log(`[perf] highlight 3000 lines: ${elapsed.toFixed(0)}ms`);
    expect(elapsed).toBeLessThan(5000);
  }, 30_000);
});

describe('hashLines', () => {
  it('is stable and sensitive to content and line count', () => {
    expect(hashLines(['a', 'b'])).toBe(hashLines(['a', 'b']));
    expect(hashLines(['a', 'b'])).not.toBe(hashLines(['a', 'c']));
    expect(hashLines(['ab'])).not.toBe(hashLines(['a', 'b']));
  });
});
