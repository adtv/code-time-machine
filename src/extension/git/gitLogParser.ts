/**
 * Parser for `git log -z --raw --numstat --format=LOG_FORMAT`.
 *
 * Layout per commit (verified empirically against git 2.43, see tests/fixtures/log-raw-numstat.bin):
 *
 *   RS hash US parents US authorName US authorEmail US authorTime US commitTime US subject US body US NUL LF
 *   ":oldMode newMode oldSha newSha STATUS" NUL path NUL [newPath NUL]        (--raw, one per change)
 *   "additions TAB deletions TAB path" NUL  |  "additions TAB deletions TAB" NUL oldPath NUL newPath NUL
 *
 * Paths are raw bytes (never quoted) because of `-z`; we decode them as UTF-8.
 */
export const LOG_FORMAT = '%x1e%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%ct%x1f%s%x1f%b%x1f';

const RS = 0x1e;
const US = 0x1f;
const NUL = 0x00;
const LF = 0x0a;
const COLON = 0x3a;

/** Number of US-terminated fields before the body. */
const FIXED_FIELDS = 7;

export type RawStatus = 'A' | 'M' | 'D' | 'R' | 'C' | 'T' | 'U' | 'X';

export interface ParsedChange {
  status: RawStatus;
  /** Similarity score for R/C (0-100). */
  score?: number;
  oldMode: string;
  newMode: string;
  oldBlob: string;
  newBlob: string;
  /** Path after the change (for D: the deleted path). */
  path: string;
  /** Path before the change, for R/C. */
  oldPath?: string;
}

export interface ParsedNumstat {
  /** null when git reported the file as binary (`-`). */
  additions: number | null;
  deletions: number | null;
  path: string;
  oldPath?: string;
}

export interface ParsedCommit {
  hash: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  /** Epoch milliseconds. */
  authorDate: number;
  committerDate: number;
  subject: string;
  body: string;
  changes: ParsedChange[];
  numstats: ParsedNumstat[];
}

export class GitLogParseError extends Error {
  constructor(
    message: string,
    readonly offset: number,
  ) {
    super(`${message} (at byte ${offset})`);
    this.name = 'GitLogParseError';
  }
}

export function parseLogOutput(buf: Uint8Array): ParsedCommit[] {
  const commits: ParsedCommit[] = [];
  const len = buf.length;
  let pos = 0;
  const decoder = new TextDecoder('utf-8');
  const text = (start: number, end: number): string => decoder.decode(buf.subarray(start, end));

  const indexOf = (byte: number, from: number): number => {
    for (let i = from; i < len; i++) {
      if (buf[i] === byte) {
        return i;
      }
    }
    return -1;
  };

  // Tolerate leading garbage (e.g. warnings) before the first record.
  while (pos < len && buf[pos] !== RS) {
    pos++;
  }

  while (pos < len) {
    pos++; // RS
    const fields: string[] = [];
    for (let i = 0; i < FIXED_FIELDS; i++) {
      const end = indexOf(US, pos);
      if (end < 0) {
        throw new GitLogParseError('Unterminated field', pos);
      }
      fields.push(text(pos, end));
      pos = end + 1;
    }
    // Body runs until a US immediately followed by NUL (or by the end of the output).
    let bodyEnd = pos;
    for (;;) {
      const idx = indexOf(US, bodyEnd);
      if (idx < 0) {
        throw new GitLogParseError('Unterminated body', pos);
      }
      if (idx + 1 >= len || buf[idx + 1] === NUL) {
        bodyEnd = idx;
        break;
      }
      bodyEnd = idx + 1;
    }
    const body = text(pos, bodyEnd).replace(/\s+$/u, '');
    pos = bodyEnd + 1;
    if (pos < len && buf[pos] === NUL) {
      pos++;
    }
    if (pos < len && buf[pos] === LF) {
      pos++;
    }

    const changes: ParsedChange[] = [];
    const numstats: ParsedNumstat[] = [];
    while (pos < len && buf[pos] !== RS) {
      const entryEnd = indexOf(NUL, pos);
      if (entryEnd < 0) {
        throw new GitLogParseError('Unterminated diff entry', pos);
      }
      if (buf[pos] === COLON) {
        const header = text(pos + 1, entryEnd).split(' ');
        const statusField = header[4] ?? '';
        const status = statusField.charAt(0) as RawStatus;
        const score =
          statusField.length > 1 ? Number.parseInt(statusField.slice(1), 10) : undefined;
        pos = entryEnd + 1;
        const p1End = indexOf(NUL, pos);
        if (p1End < 0) {
          throw new GitLogParseError('Unterminated raw path', pos);
        }
        const firstPath = text(pos, p1End);
        pos = p1End + 1;
        let change: ParsedChange;
        if (status === 'R' || status === 'C') {
          const p2End = indexOf(NUL, pos);
          if (p2End < 0) {
            throw new GitLogParseError('Unterminated raw rename path', pos);
          }
          const secondPath = text(pos, p2End);
          pos = p2End + 1;
          change = {
            status,
            oldMode: header[0] ?? '',
            newMode: header[1] ?? '',
            oldBlob: header[2] ?? '',
            newBlob: header[3] ?? '',
            path: secondPath,
            oldPath: firstPath,
          };
        } else {
          change = {
            status,
            oldMode: header[0] ?? '',
            newMode: header[1] ?? '',
            oldBlob: header[2] ?? '',
            newBlob: header[3] ?? '',
            path: firstPath,
          };
        }
        if (score !== undefined && !Number.isNaN(score)) {
          change.score = score;
        }
        changes.push(change);
      } else {
        const line = text(pos, entryEnd);
        const parts = line.split('\t');
        const additions = parts[0] === '-' ? null : Number.parseInt(parts[0] ?? '0', 10);
        const deletions = parts[1] === '-' ? null : Number.parseInt(parts[1] ?? '0', 10);
        const inlinePath = parts[2] ?? '';
        pos = entryEnd + 1;
        if (inlinePath === '') {
          // Rename form: two NUL-terminated paths follow.
          const oldEnd = indexOf(NUL, pos);
          if (oldEnd < 0) {
            throw new GitLogParseError('Unterminated numstat old path', pos);
          }
          const oldPath = text(pos, oldEnd);
          pos = oldEnd + 1;
          const newEnd = indexOf(NUL, pos);
          if (newEnd < 0) {
            throw new GitLogParseError('Unterminated numstat new path', pos);
          }
          const newPath = text(pos, newEnd);
          pos = newEnd + 1;
          numstats.push({ additions, deletions, path: newPath, oldPath });
        } else {
          numstats.push({ additions, deletions, path: inlinePath });
        }
      }
    }

    const [
      hash = '',
      parentsField = '',
      authorName = '',
      authorEmail = '',
      at = '0',
      ct = '0',
      subject = '',
    ] = fields;
    commits.push({
      hash,
      parents: parentsField.length > 0 ? parentsField.split(' ') : [],
      authorName,
      authorEmail,
      authorDate: Number.parseInt(at, 10) * 1000,
      committerDate: Number.parseInt(ct, 10) * 1000,
      subject,
      body,
      changes,
      numstats,
    });
  }
  return commits;
}
