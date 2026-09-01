// Builds real git repositories for the VS Code extension tests and a multi-root workspace file.
// Idempotent: the fixture directory is recreated on every run.
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDemoRepo } from './make-demo-repo.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = path.join(root, '.vscode-test', 'fixtures');

let clock = Date.UTC(2026, 0, 1, 12, 0, 0);
const tick = () => new Date((clock += 86_400_000)).toISOString();

function git(cwd, args, extraEnv = {}) {
  return execFileSync('git', args, {
    cwd,
    env: {
      ...process.env,
      LC_ALL: 'C',
      GIT_AUTHOR_NAME: 'Fixture Author',
      GIT_AUTHOR_EMAIL: 'fixture@example.com',
      GIT_COMMITTER_NAME: 'Fixture Author',
      GIT_COMMITTER_EMAIL: 'fixture@example.com',
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).toString();
}

function initRepo(dir) {
  mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  git(dir, ['config', 'core.autocrlf', 'false']);
}

function commit(dir, message) {
  const date = tick();
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', message], { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
}

function write(dir, rel, content) {
  const target = path.join(dir, rel);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
}

rmSync(fixtures, { recursive: true, force: true });

// repoA: three commits on a.ts
const repoA = path.join(fixtures, 'repoA');
initRepo(repoA);
write(repoA, 'a.ts', 'export const a = 1;\n');
commit(repoA, 'A: create a.ts');
write(repoA, 'a.ts', 'export const a = 1;\nexport const b = 2;\n');
commit(repoA, 'A: add b');
write(repoA, 'a.ts', 'export const a = 10;\nexport const b = 2;\nexport const c = 3;\n');
commit(repoA, 'A: change a, add c');

// repoB: service.ts with 4 commits, then renamed into src/, then one more commit; plus an untracked file
const repoB = path.join(fixtures, 'repoB');
initRepo(repoB);
write(repoB, 'service.ts', 'export class Service {\n}\n');
commit(repoB, 'B: create service');
write(repoB, 'service.ts', 'export class Service {\n  start() {\n    return true;\n  }\n}\n');
commit(repoB, 'B: add start()');
write(
  repoB,
  'service.ts',
  'export class Service {\n  start() {\n    validate();\n    return true;\n  }\n}\n',
);
commit(repoB, 'B: add validation');
write(
  repoB,
  'service.ts',
  'import { validate } from "./validate";\n\nexport class Service {\n  start() {\n    validate();\n    return true;\n  }\n}\n',
);
commit(repoB, 'B: import validate');
mkdirSync(path.join(repoB, 'src'), { recursive: true });
git(repoB, ['mv', 'service.ts', 'src/service.ts']);
commit(repoB, 'B: move into src/');
write(
  repoB,
  'src/service.ts',
  'import { validate } from "./validate";\n\nexport class Service {\n  start() {\n    validate();\n    logger.info("start");\n    return true;\n  }\n}\n',
);
commit(repoB, 'B: add logging');
write(repoB, 'untracked.ts', 'export const untracked = true;\n');

// demo: realistic 20-commit history used for visual checks and manual testing
createDemoRepo(path.join(fixtures, 'demo'));

// Default user settings for the test instance (fresh user-data-dir): a predictable theme and
// window so screenshots are comparable.
const userDir = path.join(root, '.vscode-test', 'user-data', 'User');
mkdirSync(userDir, { recursive: true });
writeFileSync(
  path.join(userDir, 'settings.json'),
  JSON.stringify(
    {
      'workbench.colorTheme': process.env.CTM_THEME ?? 'Dark Modern',
      'window.newWindowDimensions': 'default',
      'workbench.startupEditor': 'none',
      'update.mode': 'none',
      'telemetry.telemetryLevel': 'off',
      'extensions.ignoreRecommendations': true,
    },
    null,
    2,
  ),
);

const workspace = {
  folders: [
    { path: 'repoA', name: 'repoA' },
    { path: 'repoB', name: 'repoB' },
    { path: 'demo', name: 'demo' },
  ],
  settings: {
    'git.openRepositoryInParentFolders': 'never',
    'workbench.startupEditor': 'none',
  },
};
writeFileSync(path.join(fixtures, 'multi.code-workspace'), JSON.stringify(workspace, null, 2));
console.log(`fixtures ready at ${fixtures}`);
