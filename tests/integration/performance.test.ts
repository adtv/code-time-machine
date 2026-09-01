/**
 * Performance measurements on a synthetic repository (100 commits, ~3000-line file). The
 * assertions are deliberately loose safety nets; the numbers are printed so docs/PERFORMANCE.md
 * can be kept honest.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RevisionCache } from '../../src/extension/cache/revisionCache';
import { DEFAULT_SETTINGS } from '../../src/extension/config/settings';
import { GitCli } from '../../src/extension/git/gitCli';
import { HighlightCore } from '../../src/extension/highlight/highlightCore';
import { FileHistoryProvider } from '../../src/extension/history/fileHistoryProvider';
import { noopLogger } from '../../src/extension/logging/logger';
import { RevisionContentService } from '../../src/extension/revision/revisionContentService';
import type { WorkingTreeSnapshot } from '../../src/extension/revision/workingTree';
import { HistorySession } from '../../src/extension/session/historySession';
import { diffLines } from '../../src/shared/diff/lineDiff';
import { buildLineMap } from '../../src/shared/mapping/lineMap';
import type { ExtensionToWebview } from '../../src/shared/messages/protocol';
import { TestRepo } from '../helpers/gitTestRepo';

const COMMITS = 100;
const LINES = 3000;

function generate(version: number): string {
  const lines: string[] = [];
  for (let i = 0; i < LINES; i++) {
    // Every version touches ~1% of the lines and inserts a few.
    const touched = (i * 7 + version * 13) % 100 === 0;
    lines.push(
      touched
        ? `  const v${i}_${version} = compute(${i}, ${version});`
        : i % 9 === 0
          ? '}'
          : `  const v${i} = compute(${i});`,
    );
    if (version > 0 && (i + version) % 400 === 0) {
      lines.push(`  // inserted in version ${version}`);
    }
  }
  return lines.join('\n') + '\n';
}

const ms = (start: number) => `${(performance.now() - start).toFixed(0)}ms`;

describe('performance (synthetic 100-commit, 3000-line file)', () => {
  let repo: TestRepo;
  const contents: string[] = [];

  beforeAll(async () => {
    repo = await TestRepo.create('perf');
    for (let v = 0; v < COMMITS; v++) {
      const content = generate(v);
      contents.push(content);
      await repo.commitFile('src/big.ts', content, `version ${v}`);
    }
  }, 240_000);

  afterAll(async () => {
    await repo.dispose();
  });

  it('opens the history (first page) and preloads the window quickly', async () => {
    const git = new GitCli('git');
    const messages: ExtensionToWebview[] = [];
    const wt: WorkingTreeSnapshot = {
      kind: 'text',
      lines: contents[COMMITS - 1]?.split('\n').slice(0, -1) ?? [],
      eol: 'LF',
      byteLength: 0,
      dirty: false,
    };
    const session = new HistorySession(
      {
        key: 'perf',
        fileFsPath: repo.abs('src/big.ts'),
        repoRoot: repo.root,
        repoName: 'perf',
        relPath: 'src/big.ts',
        languageId: 'typescript',
      },
      {
        history: new FileHistoryProvider(git),
        content: new RevisionContentService(git, new RevisionCache()),
        workingTree: { read: () => Promise.resolve(wt) },
        settings: () => ({ ...DEFAULT_SETTINGS, preloadRevisions: 3 }),
        theme: () => 'dark',
        send: (m) => messages.push(m),
        logger: noopLogger,
      },
    );
    let t = performance.now();
    await session.start();
    const historyReady = ms(t);
    const firstView = performance.now();
    await session.settle();
    const windowReady = ms(t);
    const historyMsg = messages.find((m) => m.type === 'history');
    expect(historyMsg?.type === 'history' && historyMsg.payload.revisions.length).toBe(COMMITS);
    const views = messages.filter((m) => m.type === 'revision');
    expect(views.length).toBe(4); // active + 3 older
    console.log(
      `[perf] history of ${COMMITS} commits ready in ${historyReady}; window (4 views, diff+map) in ${windowReady}`,
    );

    t = performance.now();
    session.setActive(50);
    await session.settle();
    console.log(`[perf] jump to revision 50 (7 new views) in ${ms(t)}`);
    t = performance.now();
    session.setActive(51);
    await session.settle();
    console.log(`[perf] step to adjacent revision (1 new view) in ${ms(t)}`);
    expect(performance.now() - firstView).toBeLessThan(60_000);
  }, 120_000);

  it('diffs and maps two 3000-line revisions fast', () => {
    const a = contents[10]?.split('\n') ?? [];
    const b = contents[11]?.split('\n') ?? [];
    const t = performance.now();
    const diff = diffLines(a, b);
    const diffMs = ms(t);
    const t2 = performance.now();
    const map = buildLineMap(a, b, diff);
    console.log(
      `[perf] diff ${a.length}×${b.length} lines in ${diffMs}; map in ${ms(t2)} (overall ${map.overall.toFixed(2)})`,
    );
    expect(performance.now() - t).toBeLessThan(500);
    expect(map.degraded).toBe(false);
  });

  it('highlights a 3000-line TypeScript revision', async () => {
    const core = new HighlightCore();
    const lines = contents[0]?.split('\n') ?? [];
    await core.highlight(lines.slice(0, 5), 'typescript', 'dark');
    const t = performance.now();
    const result = await core.highlight(lines, 'typescript', 'dark');
    console.log(`[perf] highlight ${lines.length} lines in ${ms(t)}`);
    expect(result?.lines.length).toBe(lines.length);
  }, 60_000);
});
