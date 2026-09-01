// Creates a realistic demo repository for manual testing and screenshots.
// Usage: node scripts/make-demo-repo.mjs [target-dir]   (default: ../code-time-machine-demo)
// Exports createDemoRepo(dir) for reuse by the extension-test fixtures.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AUTHORS = [
  ['Sergio Pereda', 'sergio@example.com'],
  ['Ada Lovelace', 'ada@example.com'],
  ['Linus Example', 'linus@example.com'],
];

export function createDemoRepo(dir) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  let clock = Date.UTC(2026, 5, 1, 9, 0, 0);
  let n = 0;
  const git = (args, env = {}) =>
    execFileSync('git', args, {
      cwd: dir,
      env: { ...process.env, LC_ALL: 'C', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    }).toString();
  const write = (rel, content) => {
    const target = path.join(dir, rel);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  };
  const commit = (message) => {
    const [name, email] = AUTHORS[n++ % AUTHORS.length];
    clock += (6 + (n % 5) * 7) * 3_600_000; // 6–34 hours apart
    const date = new Date(clock).toISOString();
    git(['add', '-A']);
    git(['commit', '-q', '-m', message], {
      GIT_AUTHOR_NAME: name,
      GIT_AUTHOR_EMAIL: email,
      GIT_COMMITTER_NAME: name,
      GIT_COMMITTER_EMAIL: email,
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_DATE: date,
    });
  };

  git(['init', '-q', '-b', 'main']);
  git(['config', 'commit.gpgsign', 'false']);
  git(['config', 'core.autocrlf', 'false']);

  // ---- UserService.ts: 20 commits, a rename, a merge ---------------------------------------
  const svc = 'UserService.ts';
  write(
    svc,
    `export class UserService {
  constructor(private readonly repo: UserRepository) {}
}
`,
  );
  commit('Create UserService skeleton');

  write(
    svc,
    `export class UserService {
  constructor(private readonly repo: UserRepository) {}

  async login(email: string, password: string) {
    const user = await this.repo.findByEmail(email);
    return user;
  }
}
`,
  );
  commit('Add login()');

  write(
    svc,
    `export class UserService {
  constructor(private readonly repo: UserRepository) {}

  async login(email: string, password: string) {
    validate(email, password);
    const user = await this.repo.findByEmail(email);
    return user;
  }
}

function validate(email: string, password: string) {
  if (!email.includes('@')) throw new Error('Invalid email');
  if (password.length < 8) throw new Error('Password too short');
}
`,
  );
  commit('Validate credentials before lookup');

  write(
    svc,
    `export class UserService {
  constructor(private readonly repo: UserRepository) {}

  async login(email: string, password: string) {
    validate(email, password);
    const user = await this.repo.findByEmail(email);
    if (!user) {
      throw new Error('User not found');
    }
    createLegacySession(user);
    return user;
  }
}

function validate(email: string, password: string) {
  if (!email.includes('@')) throw new Error('Invalid email');
  if (password.length < 8) throw new Error('Password too short');
}

function createLegacySession(user: User) {
  sessionStore.put(user.id, { createdAt: Date.now() });
}
`,
  );
  commit('Create legacy session on login');

  write(
    svc,
    `import { sessionStore } from './session';

export class UserService {
  constructor(private readonly repo: UserRepository) {}

  async login(email: string, password: string) {
    validate(email, password);
    const user = await this.repo.findByEmail(email);
    if (!user) {
      throw new Error('User not found');
    }
    if (!(await this.repo.verifyPassword(user, password))) {
      throw new Error('Invalid credentials');
    }
    createLegacySession(user);
    return user;
  }
}

function validate(email: string, password: string) {
  if (!email.includes('@')) throw new Error('Invalid email');
  if (password.length < 8) throw new Error('Password too short');
}

function createLegacySession(user: User) {
  sessionStore.put(user.id, { createdAt: Date.now() });
}
`,
  );
  commit('Verify password hash');

  write(
    svc,
    `import { sessionStore } from './session';
import { signJwt } from './jwt';

export class UserService {
  constructor(private readonly repo: UserRepository) {}

  async login(email: string, password: string) {
    validate(email, password);
    const user = await this.repo.findByEmail(email);
    if (!user) {
      throw new Error('User not found');
    }
    if (!(await this.repo.verifyPassword(user, password))) {
      throw new Error('Invalid credentials');
    }
    const token = createJwtSession(user);
    return { user, token };
  }
}

function validate(email: string, password: string) {
  if (!email.includes('@')) throw new Error('Invalid email');
  if (password.length < 8) throw new Error('Password too short');
}

function createJwtSession(user: User) {
  return signJwt({ sub: user.id, iat: Date.now() });
}
`,
  );
  commit('Replace legacy sessions with JWT');

  const header = `/**
 * UserService
 *
 * Handles authentication and user lifecycle operations. Every public method validates its
 * input and never leaks whether an e-mail address exists.
 *
 * @module services/user
 */
import { sessionStore } from './session';
import { signJwt } from './jwt';
import { logger } from './logger';
`;
  write(
    svc,
    `${header}
export class UserService {
  constructor(private readonly repo: UserRepository) {}

  async login(email: string, password: string) {
    validate(email, password);
    const user = await this.repo.findByEmail(email);
    if (!user) {
      logger.warn('login failed: unknown user', { email });
      throw new Error('Invalid credentials');
    }
    if (!(await this.repo.verifyPassword(user, password))) {
      logger.warn('login failed: bad password', { userId: user.id });
      throw new Error('Invalid credentials');
    }
    const token = createJwtSession(user);
    logger.info('login ok', { userId: user.id });
    return { user, token };
  }
}

function validate(email: string, password: string) {
  if (!email.includes('@')) throw new Error('Invalid email');
  if (password.length < 8) throw new Error('Password too short');
}

function createJwtSession(user: User) {
  return signJwt({ sub: user.id, iat: Date.now() });
}
`,
  );
  commit('Add structured logging and doc header');

  // Rename into src/services/
  mkdirSync(path.join(dir, 'src', 'services'), { recursive: true });
  git(['mv', svc, 'src/services/UserService.ts']);
  commit('Move UserService into src/services');
  const svc2 = 'src/services/UserService.ts';

  const body = (extra, footer) => `${header}${extra}
export class UserService {
  constructor(private readonly repo: UserRepository) {}

  async login(email: string, password: string) {
    validate(email, password);
    const user = await this.repo.findByEmail(email);
    if (!user) {
      logger.warn('login failed: unknown user', { email });
      throw new Error('Invalid credentials');
    }
    if (!(await this.repo.verifyPassword(user, password))) {
      logger.warn('login failed: bad password', { userId: user.id });
      throw new Error('Invalid credentials');
    }
    const token = createJwtSession(user);
    logger.info('login ok', { userId: user.id });
    return { user, token };
  }
${footer}}

function validate(email: string, password: string) {
  if (!email.includes('@')) throw new Error('Invalid email');
  if (password.length < 8) throw new Error('Password too short');
}

function createJwtSession(user: User) {
  return signJwt({ sub: user.id, iat: Date.now() });
}
`;

  write(
    svc2,
    body(
      '',
      `
  async logout(userId: string) {
    await this.repo.revokeTokens(userId);
    logger.info('logout', { userId });
  }
`,
    ),
  );
  commit('Add logout()');

  write(
    svc2,
    body(
      '',
      `
  async logout(userId: string) {
    await this.repo.revokeTokens(userId);
    logger.info('logout', { userId });
  }

  async register(email: string, password: string) {
    validate(email, password);
    const user = await this.repo.create({ email, passwordHash: await hash(password) });
    logger.info('registered', { userId: user.id });
    return user;
  }
`,
    ),
  );
  commit('Add register()');

  // Branch: feature/reset-password
  git(['checkout', '-q', '-b', 'feature/reset-password']);
  write(
    svc2,
    body(
      '',
      `
  async logout(userId: string) {
    await this.repo.revokeTokens(userId);
    logger.info('logout', { userId });
  }

  async register(email: string, password: string) {
    validate(email, password);
    const user = await this.repo.create({ email, passwordHash: await hash(password) });
    logger.info('registered', { userId: user.id });
    return user;
  }

  async requestPasswordReset(email: string) {
    const user = await this.repo.findByEmail(email);
    if (user) {
      await mailer.sendReset(user);
    }
  }
`,
    ),
  );
  commit('Add password reset request');
  git(['checkout', '-q', 'main']);
  write(
    svc2,
    body(
      `import { hash } from './crypto';
`,
      `
  async logout(userId: string) {
    await this.repo.revokeTokens(userId);
    logger.info('logout', { userId });
  }

  async register(email: string, password: string) {
    validate(email, password);
    const user = await this.repo.create({ email, passwordHash: await hash(password) });
    logger.info('registered', { userId: user.id });
    return user;
  }
`,
    ),
  );
  commit('Import hash helper');
  {
    const [name, email] = AUTHORS[0];
    clock += 3_600_000 * 5;
    const date = new Date(clock).toISOString();
    git(
      [
        'merge',
        '-q',
        '--no-ff',
        '--no-edit',
        '-m',
        "Merge branch 'feature/reset-password'",
        'feature/reset-password',
      ],
      {
        GIT_AUTHOR_NAME: name,
        GIT_AUTHOR_EMAIL: email,
        GIT_COMMITTER_NAME: name,
        GIT_COMMITTER_EMAIL: email,
        GIT_AUTHOR_DATE: date,
        GIT_COMMITTER_DATE: date,
      },
    );
    n++;
  }

  // A few more evolutions: formatting, a deletion, a rewrite of validate()
  const afterMerge = git(['show', 'HEAD:' + svc2]);
  write(
    svc2,
    afterMerge.replace(
      "throw new Error('Password too short');",
      "throw new Error('Password must have at least 8 characters');",
    ),
  );
  commit('Clarify password error message');
  write(
    svc2,
    git(['show', 'HEAD:' + svc2]).replace(
      `function validate(email: string, password: string) {
  if (!email.includes('@')) throw new Error('Invalid email');
  if (password.length < 8) throw new Error('Password must have at least 8 characters');
}`,
      `function validate(email: string, password: string) {
  const problems: string[] = [];
  if (!EMAIL_RE.test(email)) {
    problems.push('Invalid email');
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    problems.push(\`Password must have at least \${MIN_PASSWORD_LENGTH} characters\`);
  }
  if (problems.length > 0) {
    throw new ValidationError(problems);
  }
}

const EMAIL_RE = /^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/;
const MIN_PASSWORD_LENGTH = 8;`,
    ),
  );
  commit('Rewrite validate() with collected problems');
  write(
    svc2,
    git(['show', 'HEAD:' + svc2]).replace(
      `  async logout(userId: string) {
    await this.repo.revokeTokens(userId);
    logger.info('logout', { userId });
  }

`,
      '',
    ),
  );
  commit('Remove logout() (moved to SessionService)');
  write(
    svc2,
    git(['show', 'HEAD:' + svc2]).replace(
      '  async login(email: string, password: string) {',
      '  async login(email: string, password: string): Promise<LoginResult> {',
    ),
  );
  commit('Add explicit return type to login()');
  write(
    svc2,
    git(['show', 'HEAD:' + svc2]).replace(
      "logger.info('login ok', { userId: user.id });",
      "logger.info('login ok', { userId: user.id, at: new Date().toISOString() });",
    ),
  );
  commit('Log login timestamp');
  write(svc2, git(['show', 'HEAD:' + svc2]).replaceAll("'", '"'));
  commit('Formatting: double quotes');
  write(
    svc2,
    git(['show', 'HEAD:' + svc2]).replace(
      'export class UserService {',
      'export class UserService implements AuthService {',
    ),
  );
  commit('Implement AuthService interface');

  // ---- other languages for the manual test matrix ------------------------------------------
  write(
    'app/Http/Controllers/InvoiceController.php',
    `<?php

namespace App\\Http\\Controllers;

class InvoiceController
{
    public function show(int $id)
    {
        return Invoice::findOrFail($id);
    }
}
`,
  );
  write(
    'tools/report.py',
    `def summarize(rows):\n    total = 0\n    for row in rows:\n        total += row["amount"]\n    return total\n`,
  );
  write('config/settings.json', `{\n  "retries": 3,\n  "timeout": 30\n}\n`);
  write('NOTES.txt', `Release notes\n- first version\n`);
  commit('Add PHP, Python, JSON and text samples');
  write(
    'app/Http/Controllers/InvoiceController.php',
    `<?php

namespace App\\Http\\Controllers;

use App\\Models\\Invoice;

class InvoiceController
{
    public function show(int $id)
    {
        $invoice = Invoice::findOrFail($id);
        $this->authorize('view', $invoice);
        return $invoice;
    }
}
`,
  );
  write(
    'tools/report.py',
    `def summarize(rows):\n    """Sum the amount column."""\n    return sum(row["amount"] for row in rows)\n`,
  );
  write('config/settings.json', `{\n  "retries": 5,\n  "timeout": 30,\n  "verbose": true\n}\n`);
  write('NOTES.txt', `Release notes\n- first version\n- second version with fixes\n`);
  commit('Evolve sample files');

  // Leave an uncommitted change in the working tree.
  write(svc2, git(['show', 'HEAD:' + svc2]) + '\n// TODO: add MFA support\n');
  return dir;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const target = path.resolve(
    process.argv[2] ?? path.join(process.cwd(), '..', 'code-time-machine-demo'),
  );
  if (existsSync(target) && !process.argv.includes('--force')) {
    console.error(`${target} already exists; pass --force to recreate it`);
    process.exit(1);
  }
  createDemoRepo(target);
  console.log(`demo repository created at ${target}`);
  console.log(
    'Open it in VS Code, open src/services/UserService.ts and run "Visual Git History: Open File History".',
  );
}
