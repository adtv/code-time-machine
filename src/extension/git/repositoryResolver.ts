import * as vscode from 'vscode';
import { GitError } from '../errors/gitError';
import type { Logger } from '../logging/logger';
import { toRepoRelativePath } from './paths';
import type { API, GitExtension, Repository } from './vscode-git';

export interface ResolvedFile {
  api: API;
  repository: Repository;
  /** Absolute repository root (native path). */
  repoRoot: string;
  /** Repository-relative POSIX path of the file. */
  relPath: string;
  /** Path to the git executable used by the built-in Git extension. */
  gitPath: string;
}

const INIT_TIMEOUT_MS = 15_000;

/**
 * Resolves the repository that owns a file through the built-in Git extension API. Works with
 * multi-root workspaces because the lookup is by file URI, never by `workspaceFolders[0]`.
 */
export class RepositoryResolver {
  constructor(private readonly logger: Logger) {}

  async getApi(): Promise<API> {
    const extension = vscode.extensions.getExtension<GitExtension>('vscode.git');
    if (!extension) {
      throw new GitError('GitDisabled', 'The built-in Git extension is not available');
    }
    const exports = extension.isActive ? extension.exports : await extension.activate();
    if (!exports.enabled) {
      throw new GitError('GitDisabled', 'Git is disabled ("git.enabled" is false)');
    }
    const api = exports.getAPI(1);
    if (api.state !== 'initialized') {
      await waitForInitialized(api);
    }
    if (!api.git.path) {
      throw new GitError('GitNotFound', 'The Git extension could not locate a git executable');
    }
    return api;
  }

  async resolve(uri: vscode.Uri): Promise<ResolvedFile> {
    if (uri.scheme !== 'file') {
      throw new GitError('NotRepository', `Unsupported URI scheme "${uri.scheme}"`);
    }
    const api = await this.getApi();
    let repository: Repository | null = api.getRepository(uri);
    if (!repository) {
      let root: vscode.Uri | null = null;
      try {
        root = await api.getRepositoryRoot(uri);
      } catch (error) {
        this.logger.debug(`getRepositoryRoot failed for ${uri.fsPath}: ${String(error)}`);
      }
      if (!root) {
        throw new GitError('NotRepository', `${uri.fsPath} is not inside a Git repository`);
      }
      repository = await api.openRepository(root);
      if (!repository) {
        throw new GitError('NotRepository', `Could not open repository at ${root.fsPath}`);
      }
    }
    const repoRoot = repository.rootUri.fsPath;
    const relPath = toRepoRelativePath(repoRoot, uri.fsPath);
    if (relPath === undefined) {
      throw new GitError('NotRepository', `${uri.fsPath} is outside ${repoRoot}`);
    }
    this.logger.info(`repository resolved: ${repoRoot} (${relPath})`);
    return { api, repository, repoRoot, relPath, gitPath: api.git.path };
  }
}

function waitForInitialized(api: API): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      subscription.dispose();
      reject(new GitError('GitDisabled', 'Timed out waiting for the Git extension to initialise'));
    }, INIT_TIMEOUT_MS);
    const subscription = api.onDidChangeState((state) => {
      if (state === 'initialized') {
        clearTimeout(timer);
        subscription.dispose();
        resolve();
      }
    });
  });
}
