// Build script: bundles the extension host (CommonJS/Node), the webview (IIFE/browser)
// and, on demand, the VS Code extension tests. Run with --watch, --production or --tests.
import * as esbuild from 'esbuild';
import { cp, mkdir } from 'node:fs/promises';
import { glob } from 'node:fs/promises';

const args = new Set(process.argv.slice(2));
const watch = args.has('--watch');
const production = args.has('--production');
const testsOnly = args.has('--tests');

/** @type {import('esbuild').Plugin} */
const problemMatcherPlugin = {
  name: 'problem-matcher',
  setup(build) {
    build.onStart(() => console.log('[watch] build started'));
    build.onEnd((result) => {
      for (const { text, location } of result.errors) {
        console.error(`✘ [ERROR] ${text}`);
        if (location) console.error(`    ${location.file}:${location.line}:${location.column}:`);
      }
      console.log('[watch] build finished');
    });
  },
};

/** @type {import('esbuild').BuildOptions} */
const common = {
  bundle: true,
  sourcemap: production ? false : 'linked',
  minify: production,
  logLevel: 'info',
  legalComments: 'none',
  define: { 'process.env.NODE_ENV': production ? '"production"' : '"development"' },
  plugins: watch ? [problemMatcherPlugin] : [],
};

/** @type {import('esbuild').BuildOptions} */
const extensionOptions = {
  ...common,
  entryPoints: ['src/extension/extension.ts'],
  outfile: 'dist/extension.js',
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  external: ['vscode'],
};

/** @type {import('esbuild').BuildOptions} */
const webviewOptions = {
  ...common,
  entryPoints: ['src/webview/main.tsx'],
  outdir: 'dist/webview',
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  jsxImportSource: 'preact',
};

async function collectExtensionTests() {
  const files = [];
  for await (const f of glob('tests/extension/**/*.test.ts')) files.push(f);
  return files;
}

/** @returns {Promise<import('esbuild').BuildOptions>} */
async function extensionTestOptions() {
  return {
    ...common,
    entryPoints: await collectExtensionTests(),
    outdir: 'out/tests/extension',
    outbase: 'tests/extension',
    format: 'cjs',
    platform: 'node',
    target: 'node20',
    external: ['vscode', 'mocha'],
    minify: false,
  };
}

async function copyStaticAssets() {
  await mkdir('dist/webview/codicons', { recursive: true });
  await cp('node_modules/@vscode/codicons/dist/codicon.css', 'dist/webview/codicons/codicon.css');
  await cp('node_modules/@vscode/codicons/dist/codicon.ttf', 'dist/webview/codicons/codicon.ttf');
}

async function main() {
  if (testsOnly) {
    await esbuild.build(await extensionTestOptions());
    return;
  }
  await copyStaticAssets();
  if (watch) {
    const contexts = await Promise.all([
      esbuild.context(extensionOptions),
      esbuild.context(webviewOptions),
    ]);
    await Promise.all(contexts.map((c) => c.watch()));
    return;
  }
  await Promise.all([esbuild.build(extensionOptions), esbuild.build(webviewOptions)]);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
