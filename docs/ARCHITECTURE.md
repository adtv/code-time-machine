# Architecture

Code Time Machine is a VS Code extension that lets a developer travel through a file's Git
history: revisions are shown as depth-layered cards, lines are kept synchronized between
revisions by a line-mapping engine, and navigation through time is continuous.

This document records the architecture and the decisions behind it. It is updated as phases
land; each decision states what was chosen, what was rejected, and why.

## 1. Product invariant

Every feature must serve the question _"how did this code get to its current state?"_.
The product is **CODE + TIME + LAYERS + SYNCHRONIZED LINE MAPPING + CONTINUOUS NAVIGATION**.
It is not a Git client, not a commit list with a diff viewer, and it is read-only.

## 2. Phase 0 research findings (2026-09-01)

| Topic                                                     | Verified fact                                                                                                                                                                                                                                                                                                                  | Decision                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VS Code Git API (`extensions/git/src/api/git.d.ts`, main) | `Repository.log(LogOptions)` supports `path`, `maxEntries`, `skip`, `shortStats` — **no `--follow`**. `show(ref, path)`, `diffBetween`, `getCommit` exist. `API.git.path` exposes the git binary path. `API.getRepository(uri)`, `getRepositoryRoot(uri)`, `openRepository`, `state`/`onDidChangeState`, `toGitUri(uri, ref)`. | Use the API for repository discovery, git binary path, HEAD state and `toGitUri` (read-only revision documents). Use the **Git CLI** for history because rename following is not exposed. `extensionDependencies: ["vscode.git"]`.                                                                       |
| TypeScript                                                | `typescript@latest` is 7.x (native compiler). `typescript-eslint` peer range is `>=4.8.4 <6.1.0`.                                                                                                                                                                                                                              | Pin **TypeScript 5.9.x** with `strict` and the stricter flags (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, …). Revisit when typescript-eslint supports 6/7.                                                                                                                                |
| Syntax highlighting                                       | Shiki 4.x fine-grained bundle: `shiki/core`, `shiki/engine/javascript` (all built-in grammars supported by the JS engine since 3.9.1, so no WASM asset), `@shikijs/langs/*`, `@shikijs/themes/*`.                                                                                                                              | Tokenize **in the extension host**. The webview receives compact spans + a colour palette; it never loads grammars, keeps `default-src 'none'` CSP and no WASM. Themes: `dark-plus`, `light-plus`, `github-dark-high-contrast`, `github-light-high-contrast` chosen from `window.activeColorTheme.kind`. |
| Webview framework                                         | Preact 10 (~4 KB) + `@preact/signals`. React/Svelte rejected (weight / build complexity for a small UI); pure vanilla rejected (state and component ergonomics for timeline/commit info/tests).                                                                                                                                | Preact for the shell; the **code renderer is imperative and virtualized** (thousands of rows × 4 cards must not go through a VDOM).                                                                                                                                                                      |
| Testing                                                   | `@vscode/test-cli` + `@vscode/test-electron` is the official runner (Mocha inside an Extension Development Host). Vitest 4 for everything that does not need VS Code.                                                                                                                                                          | vitest projects `unit`, `integration` (real git repositories in temp dirs), `webview` (happy-dom); `tests/extension` via `vscode-test` against a generated multi-root workspace.                                                                                                                         |
| Packaging                                                 | `@vscode/vsce` 3.x; bundling with esbuild.                                                                                                                                                                                                                                                                                     | Two bundles: `dist/extension.js` (cjs, node20, `vscode` external) and `dist/webview/main.js` (+ css). `vsce package --no-dependencies`.                                                                                                                                                                  |
| Diff                                                      | `git diff` hunks vs in-process diff.                                                                                                                                                                                                                                                                                           | **In-process** line diff (patience anchors + Myers) over hashed, optionally whitespace-normalized lines. Deterministic, unit-testable without git, and it produces the line mapping in the same pass. `git log --numstat` still supplies per-commit magnitude for the timeline.                          |
| Package manager                                           | npm (vsce/pnpm friction; lockfile committed).                                                                                                                                                                                                                                                                                  | npm                                                                                                                                                                                                                                                                                                      |

## 3. High-level structure

```
Extension Host                                        Webview
──────────────────────────────────────────            ───────────────────────────────────────
commands/            HistorySession  ── typed, validated postMessage ──▶  state (signals)
git/GitCli           spawn(api.git.path)             ◀── requests (setActive, requestRevision…)
git/RepositoryResolver (vscode.git API, multi-root)
history/FileHistoryProvider (log --follow, pagination, renames, numstat)
revision/RevisionContentService (show HASH:path, binary/size guards, working tree)
highlight/HighlightService (Shiki core, lazy grammars)
cache/RevisionCache (LRU, byte budgets)
shared/diff, shared/mapping (pure, reused by tests)
webview/WebviewPanelManager (CSP, nonce, dispose, inbound validation)
```

Rules:

- No Git logic in the webview. The webview receives render-ready data: lines, spans, diff ops,
  line maps, metadata.
- Everything that touches `vscode` lives in thin adapters; core logic (`GitCli`, parsers,
  history provider, cache, diff, mapping) is plain TypeScript so it runs under vitest.
- The extension never writes to the repository.

### Directory layout

```
src/extension/   extension.ts, commands/, git/, history/, revision/, highlight/, cache/, session/, webview/, logging/, errors/
src/shared/      models/, messages/ (protocol + validators), diff/, mapping/, util/
src/webview/     main.tsx, components/, state/, rendering/, interaction/, styles/
tests/unit | integration | webview | extension | fixtures
scripts/         make-demo-repo.mjs, prepare-extension-fixtures.mjs
docs/            ARCHITECTURE.md, LINE_MAPPING.md, TESTING.md, PERFORMANCE.md, ROADMAP.md
```

Compared with the initial proposal, `session/` (per-panel orchestrator) and `highlight/` were
added, and `diff/` + `mapping/` moved to `shared/` because they are pure and shared with tests.

## 4. Key decisions (living list)

- **History source**: `git log --follow -M … -z --name-status --numstat -- <path>` paginated with
  `--skip/-n`. The path _at each revision_ comes from the name-status record, so renames are
  followed and each revision keeps its own `path`.
- **Deck diff semantics**: the diff shown between adjacent cards is the content diff between
  adjacent entries of the file's history (the file timeline), computed in-process. Per-commit
  `+/-` shown in commit info comes from `--numstat` against the first parent. Merge commits
  are labelled as such ("merge · vs first parent").
- **Working tree**: represented as a pseudo-revision when its content differs from HEAD.
  Staged vs unstaged is a later phase.
- **Cancellation**: each active-revision change owns an `AbortController`; stale responses are
  dropped by sequence number.
- **Security**: strict CSP (`default-src 'none'`, nonce for scripts, `${cspSource}` for
  styles/fonts), no `innerHTML` with user content, all inbound messages validated, no network.

Later phases append their decisions below.
