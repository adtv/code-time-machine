import { describe, expect, it } from 'vitest';
import { SUPPORTED_LANGUAGE_IDS, resolveLanguage } from '../../src/extension/highlight/languages';

describe('resolveLanguage', () => {
  it('maps VS Code language ids to grammars', () => {
    expect(resolveLanguage('typescript')?.id).toBe('typescript');
    expect(resolveLanguage('typescriptreact')?.id).toBe('tsx');
    expect(resolveLanguage('php')?.id).toBe('php');
    expect(resolveLanguage('csharp')?.id).toBe('csharp');
    expect(resolveLanguage('shellscript')?.id).toBe('shellscript');
    expect(resolveLanguage('makefile')?.id).toBe('make');
  });

  it('falls back to the file extension for plaintext/unknown ids', () => {
    expect(resolveLanguage('plaintext', 'Invoice.php')?.id).toBe('php');
    expect(resolveLanguage('plaintext', 'view.blade.php')?.id).toBe('blade');
    expect(resolveLanguage('plaintext', 'main.cpp')?.id).toBe('cpp');
    expect(resolveLanguage('plaintext', 'Dockerfile')?.id).toBe('dockerfile');
    expect(resolveLanguage('plaintext', 'Dockerfile.prod')?.id).toBe('dockerfile');
    expect(resolveLanguage('plaintext', 'Makefile')?.id).toBe('make');
    expect(resolveLanguage('plaintext', 'README.md')?.id).toBe('markdown');
  });

  it('returns undefined for unknown languages and extensions', () => {
    expect(resolveLanguage('plaintext')).toBeUndefined();
    expect(resolveLanguage('plaintext', 'notes.txt')).toBeUndefined();
    expect(resolveLanguage('cobol', 'x.cob')).toBeUndefined();
  });

  it('covers the languages required by the specification', () => {
    for (const id of [
      'typescript',
      'javascript',
      'php',
      'python',
      'csharp',
      'java',
      'go',
      'json',
      'yaml',
      'html',
      'css',
      'sql',
    ]) {
      expect(SUPPORTED_LANGUAGE_IDS).toContain(id);
    }
  });
});
