import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RevisionCache } from '../../src/extension/cache/revisionCache';
import { DEFAULT_SETTINGS, type Settings } from '../../src/extension/config/settings';
import { GitCli } from '../../src/extension/git/gitCli';
import { FileHistoryProvider } from '../../src/extension/history/fileHistoryProvider';
import { RevisionContentService } from '../../src/extension/revision/revisionContentService';
import type {
  WorkingTreeReader,
  WorkingTreeSnapshot,
} from '../../src/extension/revision/workingTree';
import { HistorySession, type SessionTarget } from '../../src/extension/session/historySession';
import { noopLogger } from '../../src/extension/logging/logger';
import type { ExtensionToWebview, RevisionView } from '../../src/shared/messages/protocol';
import { WORKING_TREE_ID } from '../../src/shared/models/revision';
import { splitLines } from '../../src/shared/util/text';
import { TestRepo } from '../helpers/gitTestRepo';

class FakeWorkingTree implements WorkingTreeReader {
  snapshot: WorkingTreeSnapshot | undefined;
  read(): Promise<WorkingTreeSnapshot | undefined> {
    return Promise.resolve(this.snapshot);
  }
  setText(text: string, dirty = false): void {
    const { lines, eol } = splitLines(text);
    this.snapshot = { kind: 'text', lines, eol, byteLength: text.length, dirty };
  }
}

interface Harness {
  session: HistorySession;
  messages: ExtensionToWebview[];
  workingTree: FakeWorkingTree;
  views: () => RevisionView[];
  ofType: <T extends ExtensionToWebview['type']>(
    type: T,
  ) => Extract<ExtensionToWebview, { type: T }>[];
}

function harness(repo: TestRepo, relPath: string, settings: Partial<Settings> = {}): Harness {
  const git = new GitCli('git');
  const messages: ExtensionToWebview[] = [];
  const workingTree = new FakeWorkingTree();
  const target: SessionTarget = {
    key: `file://${repo.root}/${relPath}`,
    fileFsPath: repo.abs(relPath),
    repoRoot: repo.root,
    repoName: 'repo',
    relPath,
    languageId: 'typescript',
  };
  const session = new HistorySession(target, {
    history: new FileHistoryProvider(git),
    content: new RevisionContentService(git, new RevisionCache()),
    workingTree,
    settings: () => ({ ...DEFAULT_SETTINGS, ...settings }),
    theme: () => 'dark',
    send: (m) => messages.push(m),
    logger: noopLogger,
  });
  const ofType = <T extends ExtensionToWebview['type']>(type: T) =>
    messages.filter((m) => m.type === type) as Extract<ExtensionToWebview, { type: T }>[];
  return {
    session,
    messages,
    workingTree,
    ofType,
    views: () => ofType('revision').map((m) => m.payload),
  };
}

describe('HistorySession (real repository, fake webview)', () => {
  let repo: TestRepo;
  const versions = Array.from(
    { length: 20 },
    (_, i) =>
      Array.from({ length: 10 + i }, (_, l) => `line ${l} v${l <= i ? i : 0}`).join('\n') + '\n',
  );

  beforeAll(async () => {
    repo = await TestRepo.create('session');
    for (let i = 0; i < 10; i++) {
      await repo.commitFile('UserService.ts', versions[i] ?? '', `commit ${i}`);
    }
    await repo.rename('UserService.ts', 'src/UserService.ts');
    await repo.commit('move into src/', { noAdd: true });
    for (let i = 10; i < 20; i++) {
      await repo.commitFile('src/UserService.ts', versions[i] ?? '', `commit ${i}`);
    }
  });

  afterAll(async () => {
    await repo.dispose();
  });

  it('starts: init → busy → history → active → preloaded window (with maps)', async () => {
    const h = harness(repo, 'src/UserService.ts', { preloadRevisions: 2 });
    h.workingTree.setText(versions[19] ?? ''); // identical to HEAD → no working tree entry
    await h.session.start();
    await h.session.settle();

    expect(h.messages[0]?.type).toBe('init');
    expect(h.ofType('init')[0]?.payload).toMatchObject({
      fileName: 'UserService.ts',
      relPath: 'src/UserService.ts',
      languageId: 'typescript',
      theme: 'dark',
    });
    const history = h.ofType('history').at(-1)?.payload;
    expect(history?.revisions).toHaveLength(21); // 20 commits + rename
    expect(history?.hasMore).toBe(false);
    expect(history?.activeIndex).toBe(0);
    expect(history?.revisions[0]?.subject).toBe('commit 19');
    expect(history?.revisions.some((r) => r.kind === 'workingTree')).toBe(false);
    expect(h.session.snapshot.status).toBe('ready');

    const views = h.views();
    // active (0) + 2 older; index -1/-2 do not exist.
    expect(views.map((v) => v.id)).toEqual(history?.revisions.slice(0, 3).map((r) => r.id));
    const active = views[0];
    expect(active?.content.kind).toBe('text');
    expect(active?.diffFromPrevious?.previousId).toBe(history?.revisions[1]?.id);
    expect(active?.diffFromPrevious?.map.bLength).toBe(29);
    expect(active?.diffFromPrevious?.map.aLength).toBe(28);
    expect(active?.diffFromPrevious?.ops.some((o) => o.type !== 'equal')).toBe(true);
  });

  it('adds a working-tree pseudo revision when the file differs from HEAD', async () => {
    const h = harness(repo, 'src/UserService.ts', { preloadRevisions: 1 });
    h.workingTree.setText((versions[19] ?? '') + 'extra line\n', true);
    await h.session.start();
    await h.session.settle();
    const history = h.ofType('history').at(-1)?.payload;
    expect(history?.revisions[0]).toMatchObject({
      id: WORKING_TREE_ID,
      kind: 'workingTree',
      changeKind: 'WT',
      subject: 'Uncommitted changes (unsaved edits)',
    });
    expect(history?.revisions).toHaveLength(22);
    const wtView = h.views().find((v) => v.id === WORKING_TREE_ID);
    expect(wtView?.content.kind).toBe('text');
    expect(wtView?.diffFromPrevious?.deletedLines).toEqual([]);
    expect(wtView?.diffFromPrevious?.ops.filter((o) => o.type === 'insert')).toHaveLength(1);
  });

  it('setActive moves the window and keeps the rename in the history', async () => {
    const h = harness(repo, 'src/UserService.ts', { preloadRevisions: 1 });
    h.workingTree.snapshot = undefined; // file missing on disk → no WT entry
    await h.session.start();
    await h.session.settle();
    const rev = h.session.snapshot.revisions;
    const renameIndex = rev.findIndex((r) => r.changeKind === 'R');
    expect(renameIndex).toBe(10);
    expect(rev[renameIndex]?.previousPath).toBe('UserService.ts');
    expect(rev[renameIndex + 1]?.path).toBe('UserService.ts');

    h.session.setActive(renameIndex);
    await h.session.settle();
    expect(h.ofType('active').at(-1)?.payload.index).toBe(renameIndex);
    const ids = new Set(h.views().map((v) => v.id));
    expect(ids.has(rev[renameIndex]?.id ?? '')).toBe(true);
    expect(ids.has(rev[renameIndex + 1]?.id ?? '')).toBe(true);
    expect(ids.has(rev[renameIndex - 1]?.id ?? '')).toBe(true);
    const renameView = h.views().find((v) => v.id === rev[renameIndex]?.id);
    // Rename without content change: no ops other than equal.
    expect(renameView?.diffFromPrevious?.ops.every((o) => o.type === 'equal')).toBe(true);
    expect(renameView?.content.path).toBe('src/UserService.ts');

    // Snapshot reflects state; out-of-range indices are clamped.
    h.session.setActive(999);
    await h.session.settle();
    expect(h.session.snapshot.activeIndex).toBe(rev.length - 1);
    const oldest = h.views().find((v) => v.id === rev[rev.length - 1]?.id);
    expect(oldest?.diffFromPrevious).toBeUndefined();
  });

  it('rapid navigation cancels superseded preloads but ends consistent', async () => {
    const h = harness(repo, 'src/UserService.ts', { preloadRevisions: 2 });
    await h.session.start();
    await h.session.settle();
    h.session.setActive(15);
    h.session.setActive(5);
    h.session.setActive(18);
    await h.session.settle();
    const rev = h.session.snapshot.revisions;
    const ids = new Set(h.views().map((v) => v.id));
    for (let i = 16; i <= 20; i++) {
      expect(ids.has(rev[i]?.id ?? '')).toBe(true);
    }
    expect(h.session.snapshot.activeIndex).toBe(18);
    expect(h.ofType('revisionError')).toHaveLength(0);
  });

  it('pages history with loadMore and respects maxCommits', async () => {
    const h = harness(repo, 'src/UserService.ts', { maxCommits: 15, preloadRevisions: 1 });
    await h.session.start();
    await h.session.settle();
    // First page size is min(100, maxCommits) = 15 → hasMore because 21 exist but cap reached.
    expect(h.session.snapshot.revisions).toHaveLength(15);
    expect(h.session.snapshot.hasMore).toBe(false);

    const h2 = harness(repo, 'src/UserService.ts', { maxCommits: 500, preloadRevisions: 1 });
    await h2.session.start();
    await h2.session.settle();
    expect(h2.session.snapshot.revisions).toHaveLength(21);
    expect(h2.session.snapshot.hasMore).toBe(false);
    await h2.session.loadMore(); // no-op when nothing more
    expect(h2.ofType('history').length).toBeGreaterThan(0);
  });

  it('refresh reloads and keeps the active revision by id', async () => {
    const h = harness(repo, 'src/UserService.ts', { preloadRevisions: 1 });
    await h.session.start();
    await h.session.settle();
    h.session.setActive(4);
    await h.session.settle();
    const activeId = h.session.snapshot.revisions[4]?.id;
    await h.session.refresh();
    await h.session.settle();
    expect(h.session.snapshot.revisions[h.session.snapshot.activeIndex]?.id).toBe(activeId);
    expect(h.views().some((v) => v.id === activeId)).toBe(true);
  });

  it('dispose stops work', async () => {
    const h = harness(repo, 'src/UserService.ts');
    await h.session.start();
    h.session.dispose();
    await h.session.settle();
    expect(h.session.snapshot.status).toBe('disposed');
    const count = h.messages.length;
    h.session.setActive(3);
    expect(h.messages.length).toBe(count);
  });
});

describe('HistorySession empty and edge states', () => {
  let repo: TestRepo;

  beforeAll(async () => {
    repo = await TestRepo.create('session-edge');
    await repo.commitFile('tracked.ts', 'a\n', 'init');
  });

  afterAll(async () => {
    await repo.dispose();
  });

  it('reports untracked files', async () => {
    await repo.writeFile('untracked.ts', 'x\n');
    const h = harness(repo, 'untracked.ts');
    await h.session.start();
    expect(h.ofType('empty')[0]?.payload.kind).toBe('notTracked');
    expect(h.session.snapshot.status).toBe('empty');
  });

  it('reports staged-but-uncommitted files as noCommits', async () => {
    await repo.writeFile('staged.ts', 'x\n');
    await repo.git(['add', 'staged.ts']);
    const h = harness(repo, 'staged.ts');
    await h.session.start();
    expect(h.ofType('empty')[0]?.payload.kind).toBe('noCommits');
  });

  it('reports repositories without commits', async () => {
    const empty = await TestRepo.create('session-empty');
    try {
      await empty.writeFile('a.ts', 'a\n');
      const h = harness(empty, 'a.ts');
      await h.session.start();
      expect(h.ofType('empty')[0]?.payload.kind).toBe('noCommits');
    } finally {
      await empty.dispose();
    }
  });

  it('handles a file deleted in HEAD: missing content, no working tree entry', async () => {
    // Note: `git log --follow` also follows *copies*; a new file similar to an existing one
    // would inherit that file's history with changeKind 'C'. Use distinct content here.
    await repo.commitFile('gone.ts', 'gone-one\ngone-two\ngone-three\n', 'add gone');
    await repo.remove('gone.ts');
    await repo.commit('remove gone', { noAdd: true });
    const h = harness(repo, 'gone.ts', { preloadRevisions: 1 });
    h.workingTree.snapshot = undefined;
    await h.session.start();
    await h.session.settle();
    const rev = h.session.snapshot.revisions;
    expect(rev.map((r) => r.changeKind)).toEqual(['D', 'A']);
    const deletedView = h.views().find((v) => v.id === rev[0]?.id);
    expect(deletedView?.content.kind).toBe('missing');
    const addedView = h.views().find((v) => v.id === rev[1]?.id);
    expect(addedView?.content.kind).toBe('text');
  });

  it('serves binary files as binary content without diff', async () => {
    await repo.commitFile('img.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]), 'img');
    const h = harness(repo, 'img.png');
    h.workingTree.snapshot = {
      kind: 'binary',
      lines: [],
      eol: 'none',
      byteLength: 6,
      dirty: false,
    };
    await h.session.start();
    await h.session.settle();
    expect(h.session.snapshot.revisions).toHaveLength(1);
    const view = h.views()[0];
    expect(view?.content.kind).toBe('binary');
    expect(view?.diffFromPrevious).toBeUndefined();
  });

  it('flags oversized files as tooLarge', async () => {
    await repo.commitFile('big.txt', 'x'.repeat(70 * 1024) + '\n', 'big');
    const h = harness(repo, 'big.txt', { maxFileSizeBytes: 64 * 1024 });
    h.workingTree.snapshot = undefined;
    await h.session.start();
    await h.session.settle();
    expect(h.views()[0]?.content.kind).toBe('tooLarge');
  });
});
