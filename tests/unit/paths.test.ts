import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  fromRepoRelativePath,
  posixBasename,
  toRepoRelativePath,
} from '../../src/extension/git/paths';

describe('toRepoRelativePath', () => {
  const root = path.resolve('/repo');

  it('returns a posix relative path inside the root', () => {
    expect(toRepoRelativePath(root, path.join(root, 'src', 'a.ts'))).toBe('src/a.ts');
  });

  it('returns undefined for files outside the root or the root itself', () => {
    expect(toRepoRelativePath(root, path.resolve('/other/a.ts'))).toBeUndefined();
    expect(toRepoRelativePath(root, root)).toBeUndefined();
  });

  it('does not confuse sibling directories with a shared prefix', () => {
    expect(toRepoRelativePath(root, path.resolve('/repo2/a.ts'))).toBeUndefined();
  });

  it('round-trips through fromRepoRelativePath', () => {
    const abs = fromRepoRelativePath(root, 'src/deep/a.ts');
    expect(toRepoRelativePath(root, abs)).toBe('src/deep/a.ts');
  });

  it('extracts basenames', () => {
    expect(posixBasename('a/b/c.ts')).toBe('c.ts');
    expect(posixBasename('c.ts')).toBe('c.ts');
  });
});
