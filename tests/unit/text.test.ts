import { describe, expect, it } from 'vitest';
import { decodeUtf8, isProbablyBinary, splitLines } from '../../src/shared/util/text';

describe('splitLines', () => {
  it('splits LF text without a trailing empty line', () => {
    expect(splitLines('a\nb\nc\n')).toEqual({ lines: ['a', 'b', 'c'], eol: 'LF' });
  });

  it('keeps a last line without newline', () => {
    expect(splitLines('a\nb')).toEqual({ lines: ['a', 'b'], eol: 'LF' });
  });

  it('handles CRLF', () => {
    expect(splitLines('a\r\nb\r\n')).toEqual({ lines: ['a', 'b'], eol: 'CRLF' });
  });

  it('reports mixed endings', () => {
    expect(splitLines('a\r\nb\nc')).toEqual({ lines: ['a', 'b', 'c'], eol: 'mixed' });
  });

  it('handles empty and newline-less text', () => {
    expect(splitLines('')).toEqual({ lines: [], eol: 'none' });
    expect(splitLines('only')).toEqual({ lines: ['only'], eol: 'none' });
  });

  it('preserves empty lines in the middle', () => {
    expect(splitLines('a\n\n\nb\n').lines).toEqual(['a', '', '', 'b']);
  });
});

describe('isProbablyBinary', () => {
  it('detects NUL bytes', () => {
    expect(isProbablyBinary(new Uint8Array([0x61, 0x00, 0x62]))).toBe(true);
  });
  it('accepts text including UTF-8 multibyte', () => {
    expect(isProbablyBinary(new TextEncoder().encode('héllo wörld\n'))).toBe(false);
  });
  it('only inspects the first 8000 bytes', () => {
    const bytes = new Uint8Array(9000).fill(0x61);
    bytes[8500] = 0;
    expect(isProbablyBinary(bytes)).toBe(false);
  });
});

describe('decodeUtf8', () => {
  it('strips a BOM', () => {
    expect(decodeUtf8(new Uint8Array([0xef, 0xbb, 0xbf, 0x41]))).toBe('A');
  });
});
