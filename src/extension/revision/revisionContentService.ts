import type { RevisionContent } from '../../shared/models/revision';
import { decodeUtf8, isProbablyBinary, splitLines } from '../../shared/util/text';
import { RevisionCache } from '../cache/revisionCache';
import { GitError } from '../errors/gitError';
import type { GitCli } from '../git/gitCli';
import { noopLogger, type Logger } from '../logging/logger';

export interface ContentRequest {
  /** Revision id used in the resulting RevisionContent (commit hash). */
  id: string;
  /** Path at that revision (repository-relative, POSIX). */
  path: string;
  /** Full blob SHA when known (fastest, cache-friendly). */
  blobSha?: string | undefined;
  /** Commit to resolve `path` in when `blobSha` is unknown. Defaults to `id`. */
  commit?: string | undefined;
}

export interface ContentOptions {
  /** Maximum size in bytes; larger blobs yield `tooLarge` without being read. */
  maxBytes: number;
  signal?: AbortSignal;
}

/**
 * Fetches the content of a file at a revision via `git cat-file`, guarding size and binary
 * content before decoding. Results are cached by blob id.
 */
export class RevisionContentService {
  constructor(
    private readonly git: GitCli,
    private readonly cache: RevisionCache,
    private readonly logger: Logger = noopLogger,
  ) {}

  async getContent(
    repoRoot: string,
    request: ContentRequest,
    options: ContentOptions,
  ): Promise<RevisionContent> {
    const spec = request.blobSha ?? `${request.commit ?? request.id}:${request.path}`;
    const key = RevisionCache.key(repoRoot, spec);
    const cached = this.cache.get(key);
    if (cached) {
      this.logger.debug(`cache hit ${spec}`);
      return { ...cached, id: request.id, path: request.path };
    }
    this.logger.debug(`cache miss ${spec}`);

    let size: number;
    try {
      const sizeText = await this.git.runText(repoRoot, ['cat-file', '-s', spec], {
        signal: options.signal,
      });
      size = Number.parseInt(sizeText.trim(), 10);
    } catch (error) {
      if (GitError.is(error, 'RevisionNotFound')) {
        const missing: RevisionContent = { kind: 'missing', id: request.id, path: request.path };
        this.cache.set(key, missing);
        return missing;
      }
      throw error;
    }

    if (Number.isNaN(size)) {
      throw new GitError('GitCommandFailed', `Unexpected size for ${spec}`);
    }
    if (size > options.maxBytes) {
      const tooLarge: RevisionContent = {
        kind: 'tooLarge',
        id: request.id,
        path: request.path,
        byteLength: size,
        limit: options.maxBytes,
      };
      this.cache.set(key, tooLarge);
      return tooLarge;
    }

    const { stdout } = await this.git.run(repoRoot, ['cat-file', 'blob', spec], {
      signal: options.signal,
      maxBuffer: options.maxBytes + 1024 * 1024,
    });

    let content: RevisionContent;
    if (isProbablyBinary(stdout)) {
      content = { kind: 'binary', id: request.id, path: request.path, byteLength: stdout.length };
    } else {
      const { lines, eol } = splitLines(decodeUtf8(stdout));
      content = {
        kind: 'text',
        id: request.id,
        path: request.path,
        lines,
        eol,
        byteLength: stdout.length,
      };
    }
    this.cache.set(key, content);
    return content;
  }
}
