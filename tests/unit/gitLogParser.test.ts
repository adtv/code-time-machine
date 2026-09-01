import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GitLogParseError, parseLogOutput } from '../../src/extension/git/gitLogParser';
import { toRevisionMeta } from '../../src/extension/history/fileHistoryProvider';

const fixtureDir = path.join(__dirname, '..', 'fixtures');
const fixture = readFileSync(path.join(fixtureDir, 'log-raw-numstat.bin'));
const expectedLines = readFileSync(path.join(fixtureDir, 'log-raw-numstat.expected.txt'), 'utf8')
  .trim()
  .split('\n')
  .map((line) => {
    const [ids, subject] = line.split('|') as [string, string];
    const [hash, ...parents] = ids.trim().split(' ');
    return { hash, parents, subject };
  });

const RS = '\x1e';
const US = '\x1f';
const NUL = '\x00';

describe('parseLogOutput (real git 2.43 output, -z --raw --numstat --follow)', () => {
  const commits = parseLogOutput(fixture);

  it('parses every commit in order with hashes, parents and subjects', () => {
    expect(commits.map((c) => c.hash)).toEqual(expectedLines.map((e) => e.hash));
    expect(commits.map((c) => c.parents)).toEqual(expectedLines.map((e) => e.parents));
    expect(commits.map((c) => c.subject)).toEqual(expectedLines.map((e) => e.subject));
  });

  it('parses author, dates (ms) and a multi-line body', () => {
    const withBody = commits.find((c) => c.subject === 'subject line');
    expect(withBody).toBeDefined();
    expect(withBody?.body).toBe('This is the body.\nSecond body line.');
    expect(withBody?.authorName).toBe('Probe User');
    expect(withBody?.authorEmail).toBe('probe@example.com');
    expect(withBody?.authorDate).toBe(Date.UTC(2026, 0, 8, 10, 0, 0));
    expect(withBody?.committerDate).toBe(withBody?.authorDate);
    const noBody = commits.find((c) => c.subject === 'create User.ts');
    expect(noBody?.body).toBe('');
  });

  it('parses a merge commit with a first-parent diff', () => {
    const merge = commits.find((c) => c.parents.length === 2);
    expect(merge).toBeDefined();
    expect(merge?.changes).toHaveLength(1);
    expect(merge?.changes[0]?.status).toBe('M');
    expect(merge?.numstats[0]).toMatchObject({ additions: 1, deletions: 0 });
  });

  it('parses renames with old/new paths (spaces + unicode) in raw and numstat records', () => {
    const rename = commits.find((c) => c.subject.startsWith('rename'));
    expect(rename?.changes[0]).toMatchObject({
      status: 'R',
      score: 100,
      oldPath: 'User.ts',
      path: 'Dom ain/Usér Model.ts',
    });
    expect(rename?.changes[0]?.newBlob).toMatch(/^[0-9a-f]{40}$/u);
    expect(rename?.numstats[0]).toEqual({
      additions: 0,
      deletions: 0,
      oldPath: 'User.ts',
      path: 'Dom ain/Usér Model.ts',
    });
  });

  it('parses additions and deletions with an all-zero blob', () => {
    const first = commits[commits.length - 1];
    expect(first?.changes[0]).toMatchObject({ status: 'A', path: 'User.ts' });
    expect(first?.changes[0]?.oldBlob).toMatch(/^0+$/u);
    expect(first?.numstats[0]).toMatchObject({ additions: 3, deletions: 0 });
    const deleted = commits[0];
    expect(deleted?.changes[0]?.status).toBe('D');
    expect(deleted?.changes[0]?.newBlob).toMatch(/^0+$/u);
  });

  it('handles binary numstat markers and empty output', () => {
    const header = [
      'a'.repeat(40),
      '',
      'An Author',
      'a@b.c',
      '1700000000',
      '1700000000',
      'binary commit',
      '',
    ].join(US);
    const raw = `:000000 100644 ${'0'.repeat(40)} ${'b'.repeat(40)} A${NUL}img.png${NUL}`;
    const numstat = `-\t-\timg.png${NUL}`;
    const synthetic = Buffer.from(`${RS}${header}${US}${NUL}\n${raw}${numstat}`);
    const [commit] = parseLogOutput(synthetic);
    expect(commit?.numstats[0]).toEqual({ additions: null, deletions: null, path: 'img.png' });
    expect(commit?.parents).toEqual([]);
    expect(commit?.changes[0]?.status).toBe('A');
    expect(commit?.authorDate).toBe(1700000000000);
    expect(parseLogOutput(new Uint8Array(0))).toEqual([]);
  });

  it('parses a commit without diff entries followed by another record', () => {
    const rec = (hash: string): string =>
      `${RS}${[hash, '', 'A', 'a@b.c', '1', '1', 'subj', ''].join(US)}${US}${NUL}\n`;
    const commits2 = parseLogOutput(Buffer.from(rec('1'.repeat(40)) + rec('2'.repeat(40))));
    expect(commits2.map((c) => c.hash)).toEqual(['1'.repeat(40), '2'.repeat(40)]);
    expect(commits2[0]?.changes).toEqual([]);
  });

  it('keeps US characters inside the body', () => {
    const body = `line with ${US} inside\nsecond`;
    const rec = `${RS}${['3'.repeat(40), '', 'A', 'a@b.c', '1', '1', 'subj', body].join(US)}${US}${NUL}\n`;
    expect(parseLogOutput(Buffer.from(rec))[0]?.body).toBe(body);
  });

  it('throws a descriptive error on truncated input', () => {
    expect(() => parseLogOutput(fixture.subarray(0, 30))).toThrow(GitLogParseError);
  });
});

describe('toRevisionMeta', () => {
  const commits = parseLogOutput(fixture);

  it('maps rename commits with previousPath and keeps the blob sha', () => {
    const rename = commits.find((c) => c.subject.startsWith('rename'));
    const meta = toRevisionMeta(rename!, 'fallback');
    expect(meta).toMatchObject({
      kind: 'commit',
      changeKind: 'R',
      path: 'Dom ain/Usér Model.ts',
      previousPath: 'User.ts',
      isMerge: false,
      stats: { additions: 0, deletions: 0, binary: false },
    });
    expect(meta.blobSha).toMatch(/^[0-9a-f]{40}$/u);
  });

  it('marks deletions without a blob and merges with isMerge', () => {
    const deleted = toRevisionMeta(commits[0]!, 'x');
    expect(deleted.changeKind).toBe('D');
    expect(deleted.blobSha).toBeUndefined();
    const merge = commits.find((c) => c.parents.length === 2);
    expect(toRevisionMeta(merge!, 'x').isMerge).toBe(true);
  });

  it('uses the fallback path when a commit has no change entry', () => {
    const meta = toRevisionMeta(
      {
        hash: 'h',
        parents: [],
        authorName: 'a',
        authorEmail: '',
        authorDate: 0,
        committerDate: 0,
        subject: 's',
        body: '',
        changes: [],
        numstats: [],
      },
      'fallback.ts',
    );
    expect(meta.path).toBe('fallback.ts');
    expect(meta.changeKind).toBe('M');
    expect(meta.author.email).toBeUndefined();
    expect(meta.stats).toBeUndefined();
  });
});
