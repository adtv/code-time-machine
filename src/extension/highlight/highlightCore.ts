import { createHighlighterCore, type HighlighterCore, type ThemeRegistrationAny } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import type { HighlightedLines, Span, ThemeKind } from '../../shared/messages/protocol';
import { resolveLanguage } from './languages';

const THEMES: Record<ThemeKind, { name: string; load: () => Promise<{ default: unknown }> }> = {
  dark: { name: 'dark-plus', load: () => import('@shikijs/themes/dark-plus') },
  light: { name: 'light-plus', load: () => import('@shikijs/themes/light-plus') },
  highContrast: {
    name: 'github-dark-high-contrast',
    load: () => import('@shikijs/themes/github-dark-high-contrast'),
  },
  highContrastLight: {
    name: 'github-light-high-contrast',
    load: () => import('@shikijs/themes/github-light-high-contrast'),
  },
};

/**
 * Shiki-based tokenizer producing compact spans + a colour palette per request. Runs inside the
 * highlight worker (see highlight-worker.ts) but is usable in-process (tests).
 *
 * Colours come from VS Code's default themes (Dark+/Light+/high contrast) chosen by theme kind:
 * the extension API does not expose the user's token colours.
 */
export class HighlightCore {
  private highlighter: Promise<HighlighterCore> | undefined;
  private readonly loadedLanguages = new Set<string>();
  private readonly loadedThemes = new Set<string>();

  async highlight(
    lines: readonly string[],
    languageId: string,
    theme: ThemeKind,
    fileName?: string,
  ): Promise<HighlightedLines | undefined> {
    const spec = resolveLanguage(languageId, fileName);
    if (!spec) {
      return undefined;
    }
    const highlighter = await this.get();
    if (!this.loadedLanguages.has(spec.id)) {
      const grammar = (await spec.load()).default;
      await highlighter.loadLanguage(grammar as Parameters<HighlighterCore['loadLanguage']>[0]);
      this.loadedLanguages.add(spec.id);
    }
    const themeSpec = THEMES[theme];
    if (!this.loadedThemes.has(themeSpec.name)) {
      const registration = (await themeSpec.load()).default;
      await highlighter.loadTheme(registration as ThemeRegistrationAny);
      this.loadedThemes.add(themeSpec.name);
    }
    if (lines.length === 0) {
      return { palette: [highlighter.getTheme(themeSpec.name).fg], lines: [] };
    }
    const code = lines.join('\n');
    const tokenLines = highlighter.codeToTokensBase(code, {
      lang: spec.id,
      theme: themeSpec.name,
      includeExplanation: false,
    });
    const foreground = highlighter.getTheme(themeSpec.name).fg;
    const palette: string[] = [foreground];
    const colorIndex = new Map<string, number>([[foreground.toLowerCase(), 0]]);
    const out: Span[][] = [];
    for (let i = 0; i < lines.length; i++) {
      const tokens = tokenLines[i] ?? [];
      const spans: Span[] = [];
      for (const token of tokens) {
        if (token.content.length === 0) {
          continue;
        }
        const color = (token.color ?? foreground).toLowerCase();
        let index = colorIndex.get(color);
        if (index === undefined) {
          index = palette.length;
          palette.push(token.color ?? foreground);
          colorIndex.set(color, index);
        }
        const style = Number(token.fontStyle ?? 0);
        const styleBits = style > 0 ? style : 0;
        const last = spans[spans.length - 1];
        if (last?.[1] === index && (last[2] ?? 0) === styleBits) {
          last[0] += token.content;
          continue;
        }
        spans.push(styleBits ? [token.content, index, styleBits] : [token.content, index]);
      }
      out.push(spans);
    }
    return { palette, lines: out };
  }

  private get(): Promise<HighlighterCore> {
    this.highlighter ??= createHighlighterCore({
      themes: [],
      langs: [],
      engine: createJavaScriptRegexEngine({ forgiving: true }),
    });
    return this.highlighter;
  }
}
