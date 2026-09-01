/**
 * Core domain models shared by the extension host and the webview.
 * Everything here must be JSON-serialisable (it crosses the postMessage boundary).
 */

/** Sentinel id used for the working-tree pseudo revision. */
export const WORKING_TREE_ID = 'WORKING_TREE';

export type RevisionKind = 'commit' | 'workingTree';

export interface CommitAuthor {
  name: string;
  email?: string | undefined;
}

/**
 * How the file changed in this commit, relative to the previous history entry
 * (git name-status letters plus `WT` for the working tree pseudo revision).
 * - A added, M modified, R renamed, D deleted, C copied, T type change, WT working tree.
 */
export type ChangeKind = 'A' | 'M' | 'R' | 'D' | 'C' | 'T' | 'WT';

export interface RevisionStats {
  additions: number;
  deletions: number;
  /** True when git reported the change as binary (`-` in numstat). */
  binary: boolean;
}

/** Metadata for one entry in a file's history (cheap: no content). */
export interface RevisionMeta {
  /** Full commit hash, or WORKING_TREE_ID. */
  id: string;
  kind: RevisionKind;
  /** Parent hashes (empty for root commits and for the working tree). */
  parents: string[];
  author: CommitAuthor;
  /** Unix epoch milliseconds. */
  authorDate: number;
  committerDate: number;
  subject: string;
  body: string;
  /** Path of the file at this revision, relative to the repository root, POSIX separators. */
  path: string;
  /** For renames/copies: the path before this commit. */
  previousPath?: string;
  changeKind: ChangeKind;
  /** Change magnitude vs first parent (from `git log --numstat`). Missing when unknown. */
  stats?: RevisionStats;
  isMerge: boolean;
}

export type LineEnding = 'LF' | 'CRLF' | 'mixed' | 'none';

export interface TextRevisionContent {
  kind: 'text';
  id: string;
  path: string;
  /** Lines without their terminators. A trailing newline does not produce an empty last line. */
  lines: string[];
  eol: LineEnding;
  byteLength: number;
}

export interface BinaryRevisionContent {
  kind: 'binary';
  id: string;
  path: string;
  byteLength: number;
}

export interface TooLargeRevisionContent {
  kind: 'tooLarge';
  id: string;
  path: string;
  byteLength: number;
  limit: number;
}

export interface MissingRevisionContent {
  /** The file does not exist at this revision (e.g. the commit deleted it). */
  kind: 'missing';
  id: string;
  path: string;
}

export type RevisionContent =
  TextRevisionContent | BinaryRevisionContent | TooLargeRevisionContent | MissingRevisionContent;

export interface HistoryPage {
  revisions: RevisionMeta[];
  /** True when more (older) commits exist beyond this page. */
  hasMore: boolean;
}
