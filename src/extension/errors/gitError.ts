/**
 * Classified errors. UI code maps `code` to a friendly message; technical details go to the
 * output channel. Never swallow errors: wrap and rethrow with a code instead.
 */
export type GitErrorCode =
  | 'GitNotFound'
  | 'GitDisabled'
  | 'NotRepository'
  | 'FileNotTracked'
  | 'RevisionNotFound'
  | 'BinaryFile'
  | 'FileTooLarge'
  | 'GitCommandFailed'
  | 'HistoryUnavailable'
  | 'Cancelled';

export class GitError extends Error {
  constructor(
    readonly code: GitErrorCode,
    message: string,
    readonly details?: { command?: string; exitCode?: number | null; stderr?: string },
  ) {
    super(message);
    this.name = 'GitError';
  }

  /** Short, non-technical message suitable for notifications and empty states. */
  get userMessage(): string {
    return USER_MESSAGES[this.code];
  }

  static is(error: unknown, code?: GitErrorCode): error is GitError {
    return error instanceof GitError && (code === undefined || error.code === code);
  }
}

const USER_MESSAGES: Record<GitErrorCode, string> = {
  GitNotFound: 'Git was not found. Install Git or set "git.path" in your settings.',
  GitDisabled:
    'The built-in Git extension is disabled. Enable "git.enabled" to use File Time Machine.',
  NotRepository: 'This file is not inside a Git repository.',
  FileNotTracked: 'This file is not tracked by Git.',
  RevisionNotFound: 'The requested revision could not be found.',
  BinaryFile: 'Visual history for binary files is not supported yet.',
  FileTooLarge: 'This file is too large for animated history.',
  GitCommandFailed: 'A Git command failed. See the "File Time Machine" output for details.',
  HistoryUnavailable: 'No history is available for this file.',
  Cancelled: 'The operation was cancelled.',
};

/**
 * Maps a failed git invocation to a classified error using exit code and stderr patterns.
 * Patterns are matched on lower-cased stderr; they cover git 2.x messages in English (git
 * emits English unless LANG overrides it — we force `LC_ALL=C` when spawning).
 */
export function classifyGitFailure(
  args: readonly string[],
  exitCode: number | null,
  stderr: string,
): GitError {
  const command = `git ${args.join(' ')}`;
  const text = stderr.toLowerCase();
  const details = { command, exitCode, stderr: stderr.slice(0, 4000) };

  if (text.includes('not a git repository')) {
    return new GitError('NotRepository', 'Not a git repository', details);
  }
  if (
    text.includes('does not exist in') ||
    text.includes('exists on disk, but not in') ||
    text.includes('unknown revision or path not in the working tree') ||
    text.includes('bad revision') ||
    text.includes('invalid object name') ||
    text.includes('not a valid object name') ||
    (text.includes('path') && text.includes('does not exist'))
  ) {
    return new GitError('RevisionNotFound', 'Revision or path not found', details);
  }
  if (text.includes('does not have any commits yet') || text.includes('bad default revision')) {
    return new GitError('HistoryUnavailable', 'The repository has no commits yet', details);
  }
  return new GitError('GitCommandFailed', `git exited with code ${String(exitCode)}`, details);
}
