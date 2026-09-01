import type { LineEnding } from '../models/revision';

export interface SplitResult {
  lines: string[];
  eol: LineEnding;
}

/**
 * Splits text into lines, tolerating LF, CRLF and mixed endings. A trailing newline does not
 * create an extra empty line (matches how editors count lines).
 */
export function splitLines(text: string): SplitResult {
  if (text.length === 0) {
    return { lines: [], eol: 'none' };
  }
  let crlf = 0;
  let lf = 0;
  const lines: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10 /* \n */) {
      if (i > 0 && text.charCodeAt(i - 1) === 13 /* \r */) {
        crlf++;
        lines.push(text.slice(start, i - 1));
      } else {
        lf++;
        lines.push(text.slice(start, i));
      }
      start = i + 1;
    }
  }
  if (start < text.length) {
    lines.push(text.slice(start));
  }
  let eol: LineEnding;
  if (crlf === 0 && lf === 0) {
    eol = 'none';
  } else if (crlf > 0 && lf > 0) {
    eol = 'mixed';
  } else if (crlf > 0) {
    eol = 'CRLF';
  } else {
    eol = 'LF';
  }
  return { lines, eol };
}

/**
 * Heuristic binary detection compatible with git's own: a NUL byte within the first 8000 bytes.
 */
export function isProbablyBinary(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length, 8000);
  for (let i = 0; i < limit; i++) {
    if (bytes[i] === 0) {
      return true;
    }
  }
  return false;
}

/** Decodes UTF-8, stripping a BOM if present. Invalid sequences become U+FFFD. */
export function decodeUtf8(bytes: Uint8Array): string {
  const decoder = new TextDecoder('utf-8', { fatal: false, ignoreBOM: false });
  return decoder.decode(bytes);
}
