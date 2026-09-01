import { describe, expect, it } from 'vitest';
import { GitError, classifyGitFailure } from '../../src/extension/errors/gitError';

describe('classifyGitFailure', () => {
  it('classifies missing repository', () => {
    const err = classifyGitFailure(
      ['log'],
      128,
      'fatal: not a git repository (or any of the parent directories): .git',
    );
    expect(err.code).toBe('NotRepository');
    expect(err.details?.command).toBe('git log');
  });

  it('classifies missing path at revision', () => {
    const err = classifyGitFailure(
      ['show', 'abc:x.ts'],
      128,
      "fatal: path 'x.ts' does not exist in 'abc'",
    );
    expect(err.code).toBe('RevisionNotFound');
  });

  it('classifies invalid object', () => {
    expect(classifyGitFailure(['show'], 128, "fatal: invalid object name 'deadbeef'.").code).toBe(
      'RevisionNotFound',
    );
  });

  it('classifies empty repository', () => {
    expect(
      classifyGitFailure(
        ['log'],
        128,
        "fatal: your current branch 'main' does not have any commits yet",
      ).code,
    ).toBe('HistoryUnavailable');
  });

  it('falls back to GitCommandFailed with details', () => {
    const err = classifyGitFailure(['weird'], 1, 'something odd');
    expect(err.code).toBe('GitCommandFailed');
    expect(err.details?.exitCode).toBe(1);
    expect(err.userMessage).toContain('Git command failed');
    expect(GitError.is(err)).toBe(true);
    expect(GitError.is(err, 'NotRepository')).toBe(false);
    expect(GitError.is(new Error('x'))).toBe(false);
  });
});
