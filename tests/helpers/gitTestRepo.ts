import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface CommitOptions {
  /** ISO date; defaults to a deterministic, strictly increasing clock (one day per commit). */
  date?: string;
  authorName?: string;
  authorEmail?: string;
  /** Skip `git add -A` (useful when files were staged by `git mv`/`git rm`). */
  noAdd?: boolean;
  allowEmpty?: boolean;
}

/**
 * Creates a real git repository in a temp dir with deterministic author/committer data so that
 * tests can assert on hashes, order and dates. Use `dispose()` to delete it.
 */
export class TestRepo {
  private clock = Date.UTC(2026, 0, 1, 12, 0, 0);

  private constructor(readonly root: string) {}

  static async create(name = 'ftm-test'): Promise<TestRepo> {
    const base = process.env['FTM_TEST_TMP'] ?? tmpdir();
    await mkdir(base, { recursive: true });
    const root = await mkdtemp(path.join(base, `${name}-`));
    const repo = new TestRepo(root);
    await repo.git(['init', '-q', '-b', 'main']);
    await repo.git(['config', 'user.name', 'Test Author']);
    await repo.git(['config', 'user.email', 'test@example.com']);
    await repo.git(['config', 'commit.gpgsign', 'false']);
    await repo.git(['config', 'core.autocrlf', 'false']);
    await repo.git(['config', 'core.quotePath', 'true']);
    return repo;
  }

  async git(args: string[], env: Record<string, string> = {}): Promise<string> {
    const { stdout } = await execFileAsync('git', args, {
      cwd: this.root,
      env: { ...process.env, LC_ALL: 'C', ...env },
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout;
  }

  abs(rel: string): string {
    return path.join(this.root, rel);
  }

  async writeFile(rel: string, content: string | Buffer): Promise<void> {
    await mkdir(path.dirname(this.abs(rel)), { recursive: true });
    await writeFile(this.abs(rel), content);
  }

  async commit(message: string, options: CommitOptions = {}): Promise<string> {
    const date = options.date ?? new Date(this.tick()).toISOString();
    const env = {
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_DATE: date,
      GIT_AUTHOR_NAME: options.authorName ?? 'Test Author',
      GIT_AUTHOR_EMAIL: options.authorEmail ?? 'test@example.com',
      GIT_COMMITTER_NAME: 'Test Author',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    };
    if (!options.noAdd) {
      await this.git(['add', '-A']);
    }
    const args = ['commit', '-q', '-m', message];
    if (options.allowEmpty) {
      args.push('--allow-empty');
    }
    await this.git(args, env);
    return this.head();
  }

  async commitFile(
    rel: string,
    content: string | Buffer,
    message: string,
    options?: CommitOptions,
  ): Promise<string> {
    await this.writeFile(rel, content);
    return this.commit(message, options);
  }

  async rename(from: string, to: string): Promise<void> {
    await mkdir(path.dirname(this.abs(to)), { recursive: true });
    await this.git(['mv', from, to]);
  }

  async remove(rel: string): Promise<void> {
    await this.git(['rm', '-q', rel]);
  }

  async checkout(branch: string, create = false): Promise<void> {
    await this.git(create ? ['checkout', '-q', '-b', branch] : ['checkout', '-q', branch]);
  }

  async merge(branch: string, message = `Merge branch '${branch}'`): Promise<string> {
    const date = new Date(this.tick()).toISOString();
    await this.git(['merge', '-q', '--no-ff', '--no-edit', '-m', message, branch], {
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_DATE: date,
    });
    return this.head();
  }

  async head(): Promise<string> {
    return (await this.git(['rev-parse', 'HEAD'])).trim();
  }

  async revParse(ref: string): Promise<string> {
    return (await this.git(['rev-parse', ref])).trim();
  }

  async dispose(): Promise<void> {
    await rm(this.root, { recursive: true, force: true });
  }

  private tick(): number {
    this.clock += 24 * 60 * 60 * 1000;
    return this.clock;
  }
}
