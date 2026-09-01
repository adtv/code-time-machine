/**
 * Maps VS Code language ids (and, as a fallback, file extensions) to Shiki grammars. Each entry
 * is a static dynamic-import so the bundler can include the grammar lazily.
 */
export interface LanguageSpec {
  /** Shiki language id. */
  id: string;
  load: () => Promise<{ default: unknown }>;
}

const LANGUAGES: Record<string, LanguageSpec> = {
  typescript: { id: 'typescript', load: () => import('@shikijs/langs/typescript') },
  typescriptreact: { id: 'tsx', load: () => import('@shikijs/langs/tsx') },
  javascript: { id: 'javascript', load: () => import('@shikijs/langs/javascript') },
  javascriptreact: { id: 'jsx', load: () => import('@shikijs/langs/jsx') },
  php: { id: 'php', load: () => import('@shikijs/langs/php') },
  blade: { id: 'blade', load: () => import('@shikijs/langs/blade') },
  python: { id: 'python', load: () => import('@shikijs/langs/python') },
  csharp: { id: 'csharp', load: () => import('@shikijs/langs/csharp') },
  java: { id: 'java', load: () => import('@shikijs/langs/java') },
  kotlin: { id: 'kotlin', load: () => import('@shikijs/langs/kotlin') },
  go: { id: 'go', load: () => import('@shikijs/langs/go') },
  rust: { id: 'rust', load: () => import('@shikijs/langs/rust') },
  c: { id: 'c', load: () => import('@shikijs/langs/c') },
  cpp: { id: 'cpp', load: () => import('@shikijs/langs/cpp') },
  'objective-c': { id: 'objective-c', load: () => import('@shikijs/langs/objective-c') },
  swift: { id: 'swift', load: () => import('@shikijs/langs/swift') },
  dart: { id: 'dart', load: () => import('@shikijs/langs/dart') },
  ruby: { id: 'ruby', load: () => import('@shikijs/langs/ruby') },
  perl: { id: 'perl', load: () => import('@shikijs/langs/perl') },
  lua: { id: 'lua', load: () => import('@shikijs/langs/lua') },
  r: { id: 'r', load: () => import('@shikijs/langs/r') },
  json: { id: 'json', load: () => import('@shikijs/langs/json') },
  jsonc: { id: 'jsonc', load: () => import('@shikijs/langs/jsonc') },
  yaml: { id: 'yaml', load: () => import('@shikijs/langs/yaml') },
  toml: { id: 'toml', load: () => import('@shikijs/langs/toml') },
  ini: { id: 'ini', load: () => import('@shikijs/langs/ini') },
  xml: { id: 'xml', load: () => import('@shikijs/langs/xml') },
  html: { id: 'html', load: () => import('@shikijs/langs/html') },
  vue: { id: 'vue', load: () => import('@shikijs/langs/vue') },
  svelte: { id: 'svelte', load: () => import('@shikijs/langs/svelte') },
  css: { id: 'css', load: () => import('@shikijs/langs/css') },
  scss: { id: 'scss', load: () => import('@shikijs/langs/scss') },
  less: { id: 'less', load: () => import('@shikijs/langs/less') },
  sql: { id: 'sql', load: () => import('@shikijs/langs/sql') },
  graphql: { id: 'graphql', load: () => import('@shikijs/langs/graphql') },
  markdown: { id: 'markdown', load: () => import('@shikijs/langs/markdown') },
  shellscript: { id: 'shellscript', load: () => import('@shikijs/langs/shellscript') },
  powershell: { id: 'powershell', load: () => import('@shikijs/langs/powershell') },
  bat: { id: 'bat', load: () => import('@shikijs/langs/bat') },
  dockerfile: { id: 'dockerfile', load: () => import('@shikijs/langs/dockerfile') },
  makefile: { id: 'make', load: () => import('@shikijs/langs/make') },
  diff: { id: 'diff', load: () => import('@shikijs/langs/diff') },
};

const EXTENSIONS: Record<string, string> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'typescriptreact',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascriptreact',
  php: 'php',
  'blade.php': 'blade',
  py: 'python',
  cs: 'csharp',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  go: 'go',
  rs: 'rust',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  hh: 'cpp',
  m: 'objective-c',
  swift: 'swift',
  dart: 'dart',
  rb: 'ruby',
  pl: 'perl',
  lua: 'lua',
  r: 'r',
  json: 'json',
  jsonc: 'jsonc',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  ini: 'ini',
  xml: 'xml',
  html: 'html',
  htm: 'html',
  vue: 'vue',
  svelte: 'svelte',
  css: 'css',
  scss: 'scss',
  less: 'less',
  sql: 'sql',
  graphql: 'graphql',
  gql: 'graphql',
  md: 'markdown',
  sh: 'shellscript',
  bash: 'shellscript',
  zsh: 'shellscript',
  ps1: 'powershell',
  bat: 'bat',
  cmd: 'bat',
  dockerfile: 'dockerfile',
  mk: 'makefile',
  diff: 'diff',
  patch: 'diff',
};

/** Resolves the grammar for a VS Code language id, falling back to the file name's extension. */
export function resolveLanguage(languageId: string, fileName?: string): LanguageSpec | undefined {
  const direct = LANGUAGES[languageId];
  if (direct) {
    return direct;
  }
  if (!fileName) {
    return undefined;
  }
  const lower = fileName.toLowerCase();
  if (lower === 'dockerfile' || lower.startsWith('dockerfile.')) {
    return LANGUAGES['dockerfile'];
  }
  if (lower === 'makefile') {
    return LANGUAGES['makefile'];
  }
  for (const [ext, id] of Object.entries(EXTENSIONS).sort((a, b) => b[0].length - a[0].length)) {
    if (lower.endsWith(`.${ext}`)) {
      return LANGUAGES[id];
    }
  }
  return undefined;
}

export const SUPPORTED_LANGUAGE_IDS: readonly string[] = Object.keys(LANGUAGES);
