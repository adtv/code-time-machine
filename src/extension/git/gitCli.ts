import { spawn } from 'node:child_process';
import { GitError, classifyGitFailure } from '../errors/gitError';
import { noopLogger, type Logger } from '../logging/logger';

export interface GitRunOptions {
  /** Aborting kills the child process and rejects with GitError('Cancelled'). */
  signal?: AbortSignal | undefined;
  /** Maximum bytes accepted on stdout before the process is killed (default 64 MiB). */
  maxBuffer?: number;
  /** Extra environment variables. */
  env?: Record<string, string>;
  /** Exit codes treated as success besides 0 (e.g. `git diff --quiet` returns 1). */
  okExitCodes?: readonly number[];
}

export interface GitRunResult {
  stdout: Buffer;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

const DEFAULT_MAX_BUFFER = 64 * 1024 * 1024;

/**
 * Thin, dependency-free wrapper around the git executable.
 *
 * - Read-only by construction: callers pass arguments; nothing here writes to the repository,
 *   and `GIT_OPTIONAL_LOCKS=0` prevents git from taking the index lock for status-like queries.
 * - `LC_ALL=C` keeps messages in English so failures can be classified.
 * - Output is collected as a Buffer so callers can sniff for binary content before decoding.
 */
export class GitCli {
  constructor(
    readonly gitPath: string,
    private readonly logger: Logger = noopLogger,
  ) {}

  async run(
    cwd: string,
    args: readonly string[],
    options: GitRunOptions = {},
  ): Promise<GitRunResult> {
    const maxBuffer = options.maxBuffer ?? DEFAULT_MAX_BUFFER;
    const okExitCodes = options.okExitCodes ?? [];
    const started = Date.now();

    if (options.signal?.aborted) {
      throw new GitError('Cancelled', 'Operation cancelled before git was spawned');
    }

    return new Promise<GitRunResult>((resolve, reject) => {
      const child = spawn(this.gitPath, args, {
        cwd,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          LC_ALL: 'C',
          GIT_OPTIONAL_LOCKS: '0',
          GIT_TERMINAL_PROMPT: '0',
          GIT_PAGER: 'cat',
          ...options.env,
        },
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let stdoutBytes = 0;
      let settled = false;
      let killedFor: 'abort' | 'maxBuffer' | undefined;

      const finish = (fn: () => void): void => {
        if (settled) {
          return;
        }
        settled = true;
        options.signal?.removeEventListener('abort', onAbort);
        fn();
      };

      const onAbort = (): void => {
        killedFor = 'abort';
        child.kill('SIGKILL');
        // Settle now: a killed child may leave grandchildren holding the pipes open.
        finish(() => {
          this.logger.debug(`cancelled git ${args.join(' ')} after ${Date.now() - started}ms`);
          reject(
            new GitError('Cancelled', 'Git operation cancelled', {
              command: `git ${args.join(' ')}`,
            }),
          );
        });
      };
      options.signal?.addEventListener('abort', onAbort, { once: true });

      child.stdout.on('data', (chunk: Buffer) => {
        stdoutBytes += chunk.length;
        if (stdoutBytes > maxBuffer) {
          killedFor = killedFor ?? 'maxBuffer';
          child.kill('SIGKILL');
          return;
        }
        stdoutChunks.push(chunk);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        if (stderrChunks.length < 256) {
          stderrChunks.push(chunk);
        }
      });

      child.on('error', (error: NodeJS.ErrnoException) => {
        finish(() => {
          if (error.code === 'ENOENT') {
            reject(
              new GitError('GitNotFound', `Git executable not found at "${this.gitPath}"`, {
                command: `git ${args.join(' ')}`,
              }),
            );
          } else {
            reject(
              new GitError('GitCommandFailed', `Failed to spawn git: ${error.message}`, {
                command: `git ${args.join(' ')}`,
              }),
            );
          }
        });
      });

      child.on('close', (code, signal) => {
        finish(() => {
          const durationMs = Date.now() - started;
          const stderr = Buffer.concat(stderrChunks).toString('utf8');
          const command = `git ${args.join(' ')}`;

          if (killedFor === 'abort') {
            this.logger.debug(`cancelled ${command} after ${durationMs}ms`);
            reject(new GitError('Cancelled', 'Git operation cancelled', { command }));
            return;
          }
          if (killedFor === 'maxBuffer') {
            this.logger.warn(`${command} exceeded maxBuffer (${maxBuffer} bytes)`);
            reject(
              new GitError('FileTooLarge', `git output exceeded ${maxBuffer} bytes`, { command }),
            );
            return;
          }
          const exitCode = code ?? -1;
          if (exitCode === 0 || okExitCodes.includes(exitCode)) {
            this.logger.debug(`${command} → ${stdoutBytes} bytes in ${durationMs}ms`);
            resolve({ stdout: Buffer.concat(stdoutChunks), stderr, exitCode, durationMs });
            return;
          }
          this.logger.debug(
            `${command} failed (exit ${exitCode}${signal ? `, signal ${signal}` : ''}) in ${durationMs}ms`,
          );
          reject(classifyGitFailure(args, code, stderr));
        });
      });
    });
  }

  /** Runs git and returns stdout decoded as UTF-8. */
  async runText(cwd: string, args: readonly string[], options?: GitRunOptions): Promise<string> {
    const result = await this.run(cwd, args, options);
    return result.stdout.toString('utf8');
  }

  async version(): Promise<string> {
    const text = await this.runText(process.cwd(), ['--version']);
    return text.trim();
  }
}
