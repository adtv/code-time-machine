import type { ChangeKind, RevisionMeta } from '../../shared/models/revision';
import type { GitCli } from '../git/gitCli';
import { LOG_FORMAT, parseLogOutput, type ParsedCommit } from '../git/gitLogParser';
import { noopLogger, type Logger } from '../logging/logger';

export interface HistoryOptions {
  /**
   * Maximum number of commits to return, newest first. To load more history, call again with a
   * larger value: `--skip` is deliberately not used because with `--follow` git only switches to
   * the pre-rename path when the rename commit is actually *output*, so skipping past a rename
   * silently returns nothing (verified against git 2.43). Re-walking is cheap relative to the
   * tree diffs git performs anyway, and callers grow the page size geometrically.
   */
  maxCount: number;
  followRenames: boolean;
  signal?: AbortSignal | undefined;
}

export interface CommitHistoryPage {
  revisions: CommitRevisionMeta[];
  /** True when more (older) commits exist beyond `maxCount`. */
  hasMore: boolean;
}

/** RevisionMeta plus the blob id needed to fetch content cheaply. */
export interface CommitRevisionMeta extends RevisionMeta {
  kind: 'commit';
  /** Blob SHA of the file at this revision; undefined when the file was deleted here. */
  blobSha?: string;
}

/**
 * Lists the commits that touched a file, newest first, following renames.
 *
 * Merge commits: history is git's default simplification (a merge appears only when its result
 * differs from its first parent for this path), and its diff/stats are computed against the
 * first parent (`--diff-merges=first-parent`).
 */
export class FileHistoryProvider {
  constructor(
    private readonly git: GitCli,
    private readonly logger: Logger = noopLogger,
  ) {}

  async getHistory(
    repoRoot: string,
    relPath: string,
    options: HistoryOptions,
  ): Promise<CommitHistoryPage> {
    const args = [
      'log',
      '--no-color',
      ...(options.followRenames ? ['--follow'] : []),
      '-M',
      '--diff-merges=first-parent',
      '--raw',
      '--numstat',
      '--no-abbrev',
      '-z',
      `--format=${LOG_FORMAT}`,
      '-n',
      `${options.maxCount + 1}`,
      '--',
      relPath,
    ];
    const started = Date.now();
    const { stdout } = await this.git.run(repoRoot, args, { signal: options.signal });
    const parsed = parseLogOutput(stdout);
    const hasMore = parsed.length > options.maxCount;
    const page = hasMore ? parsed.slice(0, options.maxCount) : parsed;
    const revisions = page.map((commit) => toRevisionMeta(commit, relPath));
    this.logger.info(
      `history loaded: ${revisions.length} commit(s) for ${relPath} (max ${options.maxCount}) in ${Date.now() - started}ms`,
    );
    return { revisions, hasMore };
  }

  /** True when the path is in the index (tracked), regardless of whether it has commits. */
  async isTracked(repoRoot: string, relPath: string, signal?: AbortSignal): Promise<boolean> {
    const out = await this.git.run(repoRoot, ['ls-files', '-z', '--', relPath], { signal });
    return out.stdout.length > 0;
  }
}

export function toRevisionMeta(commit: ParsedCommit, fallbackPath: string): CommitRevisionMeta {
  // With --follow and a single pathspec there is exactly one change per commit for our file.
  const change = commit.changes[0];
  const numstat = commit.numstats[0];
  const changeKind = toChangeKind(change?.status);
  const meta: CommitRevisionMeta = {
    id: commit.hash,
    kind: 'commit',
    parents: commit.parents,
    author: { name: commit.authorName, email: commit.authorEmail || undefined },
    authorDate: commit.authorDate,
    committerDate: commit.committerDate,
    subject: commit.subject,
    body: commit.body,
    path: change?.path ?? fallbackPath,
    changeKind,
    isMerge: commit.parents.length > 1,
  };
  if (change?.oldPath !== undefined) {
    meta.previousPath = change.oldPath;
  }
  if (change && changeKind !== 'D' && !/^0+$/u.test(change.newBlob)) {
    meta.blobSha = change.newBlob;
  }
  if (numstat) {
    const binary = numstat.additions === null || numstat.deletions === null;
    meta.stats = {
      additions: numstat.additions ?? 0,
      deletions: numstat.deletions ?? 0,
      binary,
    };
  }
  return meta;
}

const CHANGE_KINDS: Partial<Record<string, ChangeKind>> = {
  A: 'A',
  D: 'D',
  R: 'R',
  C: 'C',
  T: 'T',
};

function toChangeKind(status: string | undefined): ChangeKind {
  return (status !== undefined ? CHANGE_KINDS[status] : undefined) ?? 'M';
}
