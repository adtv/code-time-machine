import path from 'node:path';

/**
 * Converts an absolute file system path into a repository-relative POSIX path, or returns
 * undefined when the file is outside the repository root.
 */
export function toRepoRelativePath(repoRoot: string, fileFsPath: string): string | undefined {
  const rel = path.relative(repoRoot, fileFsPath);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    return undefined;
  }
  return rel.split(path.sep).join('/');
}

/** Joins a repository root and a POSIX relative path into a native absolute path. */
export function fromRepoRelativePath(repoRoot: string, relPosixPath: string): string {
  return path.join(repoRoot, ...relPosixPath.split('/'));
}

export function posixBasename(relPosixPath: string): string {
  const idx = relPosixPath.lastIndexOf('/');
  return idx >= 0 ? relPosixPath.slice(idx + 1) : relPosixPath;
}
