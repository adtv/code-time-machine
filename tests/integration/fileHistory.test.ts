import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RevisionCache } from '../../src/extension/cache/revisionCache';
import { GitError } from '../../src/extension/errors/gitError';
import { GitCli } from '../../src/extension/git/gitCli';
import { FileHistoryProvider } from '../../src/extension/history/fileHistoryProvider';
import { RevisionContentService } from '../../src/extension/revision/revisionContentService';
import { TestRepo } from '../helpers/gitTestRepo';

const git = new GitCli('git');
const provider = new FileHistoryProvider(git);
const MAX = 2 * 1024 * 1024;

/**
 * Scenario from the specification:
 *   1 create UserService.ts  2 add login()  3 add validation  4 rename → UserModel.ts
 *   5 modify function  6 delete block  7 move function  (+ 8 second rename → Domain/User.ts)
 */
describe('FileHistoryProvider with a real repository', () => {
  let repo: TestRepo;
  const hashes: string[] = [];
  const contents: string[] = [];

  const v1 = 'export class UserService {\n}\n';
  const v2 = 'export class UserService {\n  login() {\n    return true;\n  }\n}\n';
  const v3 = 'export class UserService {\n  login() {\n    validate();\n    return true;\n  }\n}\n';
  const v5 =
    'export class UserService {\n  login() {\n    validate();\n    logger();\n    return token;\n  }\n}\n';
  const v6 = 'export class UserService {\n  login() {\n    return token;\n  }\n}\n';
  const v7 =
    'function helper() {}\n\nexport class UserService {\n  login() {\n    return token;\n  }\n}\n';

  beforeAll(async () => {
    repo = await TestRepo.create('history');
    const push = (hash: string, content: string): void => {
      hashes.push(hash);
      contents.push(content);
    };
    push(await repo.commitFile('UserService.ts', v1, 'create UserService.ts'), v1);
    push(await repo.commitFile('UserService.ts', v2, 'add login()'), v2);
    push(await repo.commitFile('UserService.ts', v3, 'add validation'), v3);
    await repo.rename('UserService.ts', 'UserModel.ts');
    push(await repo.commit('rename file', { noAdd: true }), v3);
    push(await repo.commitFile('UserModel.ts', v5, 'modify function'), v5);
    push(await repo.commitFile('UserModel.ts', v6, 'delete block'), v6);
    push(await repo.commitFile('UserModel.ts', v7, 'move function'), v7);
    await repo.rename('UserModel.ts', 'Domain/User.ts');
    push(await repo.commit('rename into Domain/', { noAdd: true }), v7);
  });

  afterAll(async () => {
    await repo.dispose();
  });

  it('returns commits newest first with matching hashes and subjects', async () => {
    const page = await provider.getHistory(repo.root, 'Domain/User.ts', {
      maxCount: 100,
      followRenames: true,
    });
    expect(page.hasMore).toBe(false);
    expect(page.revisions.map((r) => r.id)).toEqual([...hashes].reverse());
    expect(page.revisions.map((r) => r.subject)).toEqual([
      'rename into Domain/',
      'move function',
      'delete block',
      'modify function',
      'rename file',
      'add validation',
      'add login()',
      'create UserService.ts',
    ]);
    expect(page.revisions[0]?.author).toEqual({ name: 'Test Author', email: 'test@example.com' });
    // Deterministic clock: strictly decreasing dates.
    for (let i = 1; i < page.revisions.length; i++) {
      expect(page.revisions[i - 1]?.authorDate).toBeGreaterThan(page.revisions[i]?.authorDate ?? 0);
    }
  });

  it('keeps the path of the file at each revision across two renames', async () => {
    const { revisions } = await provider.getHistory(repo.root, 'Domain/User.ts', {
      maxCount: 100,
      followRenames: true,
    });
    expect(revisions.map((r) => r.path)).toEqual([
      'Domain/User.ts',
      'UserModel.ts',
      'UserModel.ts',
      'UserModel.ts',
      'UserModel.ts',
      'UserService.ts',
      'UserService.ts',
      'UserService.ts',
    ]);
    const renames = revisions.filter((r) => r.changeKind === 'R');
    expect(renames.map((r) => [r.previousPath, r.path])).toEqual([
      ['UserModel.ts', 'Domain/User.ts'],
      ['UserService.ts', 'UserModel.ts'],
    ]);
    expect(revisions[revisions.length - 1]?.changeKind).toBe('A');
  });

  it('reports additions/deletions per commit', async () => {
    const { revisions } = await provider.getHistory(repo.root, 'Domain/User.ts', {
      maxCount: 100,
      followRenames: true,
    });
    const bySubject = new Map(revisions.map((r) => [r.subject, r.stats]));
    expect(bySubject.get('create UserService.ts')).toEqual({
      additions: 2,
      deletions: 0,
      binary: false,
    });
    expect(bySubject.get('add login()')).toEqual({ additions: 3, deletions: 0, binary: false });
    expect(bySubject.get('delete block')).toEqual({ additions: 0, deletions: 2, binary: false });
    expect(bySubject.get('rename file')).toEqual({ additions: 0, deletions: 0, binary: false });
  });

  it('pages by growing maxCount and reports hasMore (works across renames)', async () => {
    const first = await provider.getHistory(repo.root, 'Domain/User.ts', {
      maxCount: 3,
      followRenames: true,
    });
    expect(first.revisions).toHaveLength(3);
    expect(first.hasMore).toBe(true);
    // A boundary right after a rename commit: the older entries must keep coming.
    const second = await provider.getHistory(repo.root, 'Domain/User.ts', {
      maxCount: 6,
      followRenames: true,
    });
    expect(second.revisions.map((r) => r.subject).slice(3)).toEqual([
      'modify function',
      'rename file',
      'add validation',
    ]);
    expect(second.revisions.map((r) => r.path).slice(3)).toEqual([
      'UserModel.ts',
      'UserModel.ts',
      'UserService.ts',
    ]);
    expect(second.hasMore).toBe(true);
    const all = await provider.getHistory(repo.root, 'Domain/User.ts', {
      maxCount: 8,
      followRenames: true,
    });
    expect(all.revisions).toHaveLength(8);
    expect(all.hasMore).toBe(false);
  });

  it('stops at renames when followRenames is false', async () => {
    const { revisions } = await provider.getHistory(repo.root, 'Domain/User.ts', {
      maxCount: 100,
      followRenames: false,
    });
    expect(revisions).toHaveLength(1);
    expect(revisions[0]?.subject).toBe('rename into Domain/');
  });

  it('fetches the exact content of every revision (by blob and by commit:path)', async () => {
    const service = new RevisionContentService(git, new RevisionCache());
    const { revisions } = await provider.getHistory(repo.root, 'Domain/User.ts', {
      maxCount: 100,
      followRenames: true,
    });
    const expected = [...contents].reverse();
    for (const [i, rev] of revisions.entries()) {
      const byBlob = await service.getContent(
        repo.root,
        { id: rev.id, path: rev.path, blobSha: rev.blobSha },
        { maxBytes: MAX },
      );
      expect(byBlob.kind).toBe('text');
      if (byBlob.kind === 'text') {
        expect(byBlob.lines.join('\n') + '\n').toBe(expected[i]);
        expect(byBlob.eol).toBe('LF');
      }
      const byPath = await service.getContent(
        repo.root,
        { id: rev.id, path: rev.path },
        { maxBytes: MAX },
      );
      expect(byPath).toMatchObject({ kind: 'text', id: rev.id, path: rev.path });
    }
  });

  it('reports untracked files and tracked files', async () => {
    await repo.writeFile('untracked.ts', 'x\n');
    expect(await provider.isTracked(repo.root, 'untracked.ts')).toBe(false);
    expect(await provider.isTracked(repo.root, 'Domain/User.ts')).toBe(true);
    const page = await provider.getHistory(repo.root, 'untracked.ts', {
      maxCount: 10,
      followRenames: true,
    });
    expect(page.revisions).toEqual([]);
  });
});

describe('FileHistoryProvider edge cases', () => {
  let repo: TestRepo;

  beforeAll(async () => {
    repo = await TestRepo.create('edges');
  });

  afterAll(async () => {
    await repo.dispose();
  });

  it('lists merge commits with first-parent stats and isMerge', async () => {
    await repo.commitFile('m.ts', 'a\nb\nc\n', 'base');
    await repo.checkout('feature', true);
    await repo.commitFile('m.ts', 'a\nb\nc\nfeature\n', 'feature change');
    await repo.checkout('main');
    await repo.commitFile('m.ts', 'main\na\nb\nc\n', 'main change');
    const mergeHash = await repo.merge('feature');
    const { revisions } = await provider.getHistory(repo.root, 'm.ts', {
      maxCount: 10,
      followRenames: true,
    });
    const merge = revisions.find((r) => r.id === mergeHash);
    expect(merge).toBeDefined();
    expect(merge?.isMerge).toBe(true);
    expect(merge?.parents).toHaveLength(2);
    // vs first parent (main change): only the feature line was added.
    expect(merge?.stats).toEqual({ additions: 1, deletions: 0, binary: false });
    expect(revisions.map((r) => r.subject)).toEqual([
      "Merge branch 'feature'",
      'main change',
      'feature change',
      'base',
    ]);
  });

  it('detects binary files in stats and content', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x01]);
    const hash = await repo.commitFile('img.png', png, 'add image');
    const { revisions } = await provider.getHistory(repo.root, 'img.png', {
      maxCount: 10,
      followRenames: true,
    });
    expect(revisions[0]?.stats?.binary).toBe(true);
    const service = new RevisionContentService(git, new RevisionCache());
    const content = await service.getContent(
      repo.root,
      { id: hash, path: 'img.png', blobSha: revisions[0]?.blobSha },
      { maxBytes: MAX },
    );
    expect(content).toMatchObject({ kind: 'binary', byteLength: png.length });
  });

  it('preserves CRLF information and unicode content', async () => {
    const hash = await repo.commitFile('crlf.txt', 'uno\r\ndos\r\ntrés\r\n', 'crlf file');
    const service = new RevisionContentService(git, new RevisionCache());
    const content = await service.getContent(
      repo.root,
      { id: hash, path: 'crlf.txt' },
      { maxBytes: MAX },
    );
    expect(content).toMatchObject({ kind: 'text', eol: 'CRLF', lines: ['uno', 'dos', 'trés'] });
  });

  it('marks deleted files and returns missing content for the deleting commit', async () => {
    await repo.commitFile('gone.ts', 'x\n', 'add gone');
    await repo.remove('gone.ts');
    const del = await repo.commit('delete gone', { noAdd: true });
    const { revisions } = await provider.getHistory(repo.root, 'gone.ts', {
      maxCount: 10,
      followRenames: true,
    });
    expect(revisions.map((r) => r.changeKind)).toEqual(['D', 'A']);
    expect(revisions[0]?.blobSha).toBeUndefined();
    const service = new RevisionContentService(git, new RevisionCache());
    const content = await service.getContent(
      repo.root,
      { id: del, path: 'gone.ts' },
      { maxBytes: MAX },
    );
    expect(content.kind).toBe('missing');
  });

  it('returns tooLarge without reading oversized blobs', async () => {
    const hash = await repo.commitFile('big.txt', 'x'.repeat(5000) + '\n', 'big');
    const service = new RevisionContentService(git, new RevisionCache());
    const content = await service.getContent(
      repo.root,
      { id: hash, path: 'big.txt' },
      { maxBytes: 1000 },
    );
    expect(content).toMatchObject({ kind: 'tooLarge', byteLength: 5001, limit: 1000 });
  });

  it('serves repeated requests from the cache', async () => {
    const cache = new RevisionCache();
    const service = new RevisionContentService(git, cache);
    const head = await repo.head();
    await service.getContent(repo.root, { id: head, path: 'big.txt' }, { maxBytes: MAX });
    await service.getContent(repo.root, { id: head, path: 'big.txt' }, { maxBytes: MAX });
    expect(cache.stats).toMatchObject({ hits: 1, misses: 1 });
  });

  it('fails with HistoryUnavailable in a repository without commits', async () => {
    const empty = await TestRepo.create('empty');
    try {
      await empty.writeFile('a.ts', 'a\n');
      await expect(
        provider.getHistory(empty.root, 'a.ts', { maxCount: 10, followRenames: true }),
      ).rejects.toMatchObject({ code: 'HistoryUnavailable' });
    } finally {
      await empty.dispose();
    }
  });

  it('fails with NotRepository outside a repository', async () => {
    const outside = await TestRepo.create('outside');
    try {
      await outside.git(['init', '-q']);
      const { rm } = await import('node:fs/promises');
      await rm(`${outside.root}/.git`, { recursive: true, force: true });
      await expect(
        provider.getHistory(outside.root, 'a.ts', { maxCount: 10, followRenames: true }),
      ).rejects.toSatisfy((e: unknown) => GitError.is(e, 'NotRepository'));
    } finally {
      await outside.dispose();
    }
  });
});
