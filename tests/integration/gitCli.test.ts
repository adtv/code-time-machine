import { chmod, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GitCli } from '../../src/extension/git/gitCli';
import { TestRepo } from '../helpers/gitTestRepo';

const isWindows = process.platform === 'win32';

describe('GitCli', () => {
  let repo: TestRepo;

  beforeAll(async () => {
    repo = await TestRepo.create('cli');
    await repo.commitFile('a.txt', 'hello\n', 'init');
  });

  afterAll(async () => {
    await repo.dispose();
  });

  it('runs git and returns stdout as a Buffer', async () => {
    const git = new GitCli('git');
    const result = await git.run(repo.root, ['rev-parse', '--show-toplevel']);
    expect(result.exitCode).toBe(0);
    expect(Buffer.isBuffer(result.stdout)).toBe(true);
    expect(result.stdout.toString('utf8').trim().length).toBeGreaterThan(0);
    expect(await git.version()).toMatch(/^git version/u);
  });

  it('rejects with GitNotFound when the executable does not exist', async () => {
    const git = new GitCli(path.join(repo.root, 'no-such-git'));
    await expect(git.run(repo.root, ['--version'])).rejects.toMatchObject({ code: 'GitNotFound' });
  });

  it('rejects immediately with Cancelled when the signal is already aborted', async () => {
    const git = new GitCli('git');
    const controller = new AbortController();
    controller.abort();
    await expect(
      git.run(repo.root, ['--version'], { signal: controller.signal }),
    ).rejects.toMatchObject({
      code: 'Cancelled',
    });
  });

  it.skipIf(isWindows)('kills a running process when aborted', async () => {
    const fake = path.join(repo.root, 'slow-git.sh');
    await writeFile(fake, '#!/bin/sh\nexec sleep 10\n');
    await chmod(fake, 0o755);
    const git = new GitCli(fake);
    const controller = new AbortController();
    const started = Date.now();
    const promise = git.run(repo.root, ['log'], { signal: controller.signal });
    setTimeout(() => controller.abort(), 50);
    await expect(promise).rejects.toMatchObject({ code: 'Cancelled' });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it.skipIf(isWindows)('rejects with FileTooLarge when maxBuffer is exceeded', async () => {
    const fake = path.join(repo.root, 'noisy-git.sh');
    await writeFile(fake, '#!/bin/sh\nexec head -c 300000 /dev/zero\n');
    await chmod(fake, 0o755);
    const git = new GitCli(fake);
    await expect(git.run(repo.root, ['log'], { maxBuffer: 1000 })).rejects.toMatchObject({
      code: 'FileTooLarge',
    });
  });

  it('classifies failures and accepts okExitCodes', async () => {
    const git = new GitCli('git');
    await expect(git.run(repo.root, ['show', 'deadbeef:a.txt'])).rejects.toMatchObject({
      code: 'RevisionNotFound',
    });
    const result = await git.run(repo.root, ['diff', '--quiet', 'HEAD', '--', 'a.txt'], {
      okExitCodes: [1],
    });
    expect([0, 1]).toContain(result.exitCode);
  });
});
