import type { HighlightedLines, ThemeKind } from '../../shared/messages/protocol';

export interface HighlightRequest {
  id: number;
  lines: string[];
  languageId: string;
  theme: ThemeKind;
  fileName?: string;
}

export type HighlightResponse =
  { id: number; result: HighlightedLines | undefined } | { id: number; error: string };
