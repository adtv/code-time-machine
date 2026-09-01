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

- **History source**: `git log --follow -M --diff-merges=first-parent --raw --numstat --no-abbrev -z
--format=… -n <count+1> -- <path>`. `--raw` gives status (A/M/D/R/C), old/new path and the blob
  SHA at each revision (used as the content cache key); `--numstat` gives magnitude. Findings
  that shaped this (verified against git 2.43, fixtures in `tests/fixtures`):
  - `--name-status` and `--numstat` together emit only name-status; `--raw` + `--numstat` combine.
  - **`--skip` is unreliable with `--follow`**: git switches to the pre-rename path only when the
    rename commit is actually output, so a page starting just after a rename returns nothing.
    Pagination therefore re-requests with a growing `-n` (100 → 300 → 700 …) and slices; the walk
    is identical to a one-shot `--follow`, and the extra cost is bounded by the tree diffs git
    performs anyway. `maxCommits` caps the total.
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

## 5. Runtime data flow (as implemented)

```
open command ─▶ PanelManager.open(uri)
   ├─ RepositoryResolver (vscode.git API) → repoRoot, relPath, git path
   ├─ HistoryPanel (webview, strict CSP, outbound queue until 'ready')
   └─ HistorySession.start()
        ├─ FileHistoryProvider.getHistory(maxCount)  →  RevisionMeta[]  (+ WT pseudo revision)
        ├─ send init / history / active
        └─ preload window: for index in [N, N+1, N-1, N+2, N-2, …]
              content(N) + content(N+1) → highlight (worker) → diff + LineMap → send 'revision'
webview: store (signals) → RevisionDeck (cards by slot) → CodeView (virtualised rows)
         user scroll → ScrollSyncController → mapLineAcross → neighbours re-centred
         Alt+wheel / keys / timeline / click → setActive → host preloads the new window
```

## 6. Webview design decisions

- **Deck geometry.** Newer revisions stack _above_ the active card, older ones _below_; wheel
  down / `J` / PageDown = older, matching a newest-first timeline. The newer card peeks by exactly
  its header height and the older card by its footer height (`--ctm-peek`), so what peeks is
  always readable (hash, subject, author, date, stats). One hidden card on each side lets cards
  fade in/out instead of popping. Cards are keyed by revision id: the same DOM node moves between
  slots, so a CSS transition (200 ms, `cubic-bezier(0.2, 0.8, 0.2, 1)`) animates the travel and
  the card keeps its scroll position. `prefers-reduced-motion` and `vscode-reduce-motion`
  disable transitions.
- **Permanent footer.** Every card has a header and a footer of the same height (status line on
  the active card, identity on background cards) and both are `flex: 0 0 auto`. This is not
  cosmetic: all cards must have the same code-viewport height, otherwise the "centre line"
  differs between a background card and the same card once it becomes active.
- **Synchronized scrolling.** The controller keeps one logical anchor (revision index, content
  line at the viewport centre, pixel offset). Background cards are re-centred on the mapped line
  by chaining the adjacent `LineMap`s (`mapLineAcross`); when the active revision changes the
  anchor is re-expressed in the new revision, so the incoming card does not jump. Mapping through
  ghost rows is handled by `rowOfLine` tables in each card. Low confidence shows an
  "≈ approximate alignment" badge; nothing is invented.
- **Time-travel input.** Primary: modifier + wheel (`timeTravelModifier`, default Alt) with a
  delta accumulator (mouse notches and trackpad inertia both work) and a cooldown for the
  transition; plain wheel always scrolls the file. Secondary: J/K, PageUp/PageDown, Alt+↑/↓,
  Alt+Home/End, Prev/Next buttons, timeline click/keyboard, clicking a peeking card. Ctrl+wheel
  was rejected as primary because browsers/VS Code use it for zoom; Shift+wheel because many
  devices map it to horizontal scroll.
- **Rendering.** Preact + signals for the shell; the code area is an imperative virtualised
  renderer (`CodeView`) that creates DOM with `textContent` only. Ghost rows are interleaved where
  the removed lines used to be; added rows carry a `+` marker and the diff-editor background
  tokens so the meaning does not depend on colour alone.

## 7. Highlighting

Shiki (fine-grained core + JavaScript regex engine, no WASM) runs in a **worker thread**
(`dist/highlight-worker.js`, ~3 MB with grammars) so tokenising never blocks the extension host;
`dist/extension.js` stays around 80 KB. Themes follow the VS Code theme _kind_ (Dark+, Light+,
GitHub high-contrast variants) because the API does not expose the user's token colours. Output
is a palette plus `[text, colourIndex, fontStyle?]` spans per line, cached by content hash.

## 8. Testing strategy

Unit (pure modules), integration (real git repositories created in temp dirs), webview
(happy-dom + Testing Library), extension (`@vscode/test-cli` inside VS Code with a generated
multi-root workspace) and a **visual harness** that drives the real window through the Chromium
DevTools Protocol: screenshots plus DOM inspection of the webview, used to assert the scroll
synchronisation numerically and to exercise Alt+wheel, keyboard and timeline clicks. See
`docs/TESTING.md`.

## 9. Security and privacy

No network, no telemetry. Webview CSP is `default-src 'none'` with a per-load nonce for scripts
and `${cspSource}` for styles/fonts; no `innerHTML` with repository content; every message from
the webview is validated (`parseWebviewMessage`) and unknown messages are logged and dropped.
All git invocations are read-only and run with `GIT_OPTIONAL_LOCKS=0`; the extension never
writes to the repository or the file system.

## 10. Known limitations

- Highlight colours are VS Code's default themes, not the user's custom theme.
- `git log --follow` also follows copies (a new file similar to an existing one inherits that
  history, flagged `copied from …`) and can lose the trail on rename + heavy rewrite.
- Moved blocks are delete + insert; alignment inside a moved block is approximate.
- Staged vs unstaged is not distinguished yet (Working Tree vs HEAD only).
- Binary files are detected but not rendered.
