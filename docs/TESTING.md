# Testing

File Time Machine is verified at four levels plus a documented manual matrix. All automated
suites must be green before a release (`npm run check && npm run test:extension`).

## Automated suites

| Command                    | Runner                                    | What it covers                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run test:unit`        | Vitest (node)                             | git log parser (real captured output), path resolution, LRU/RevisionCache, settings, protocol validators, revision view builder, **diff engine and LineMappingEngine** (fixtures A–H, moved block, composition, randomised property tests), language mapping                                                                                                                        |
| `npm run test:integration` | Vitest (node) + real `git` in temp repos  | GitCli (cancellation, maxBuffer, errors), FileHistoryProvider (two renames, merge with first-parent stats, binary, CRLF, deleted file, empty repo, non-repo, paging), RevisionContentService, **HistorySession** end to end with a fake webview (working tree entry, preload window, rapid navigation, paging, refresh, empty states), Shiki highlighting, performance measurements |
| `npm run test:webview`     | Vitest + happy-dom + Testing Library      | store, row model (ghost/added rows), virtualised CodeView geometry, deck slots and clicks, wheel accumulator, scroll-sync mapping chain, timeline                                                                                                                                                                                                                                   |
| `npm run test:extension`   | `@vscode/test-cli` (Mocha inside VS Code) | activation, command registration, multi-root repository detection, rename following, prev/next commands, untracked-file empty state, panel reuse, syntax highlighting through the worker                                                                                                                                                                                            |
| `npm test`                 | all Vitest projects                       | —                                                                                                                                                                                                                                                                                                                                                                                   |

Temporary repositories are created under `os.tmpdir()` (override with `FTM_TEST_TMP`) and
removed afterwards. Extension tests generate their fixtures with
`scripts/prepare-extension-fixtures.mjs` into `.vscode-test/fixtures` (two small repositories, the
demo repository and a multi-root `.code-workspace`).

### Running the extension tests locally

They download VS Code stable into `.vscode-test/` and launch it. On Linux you need a display
(WSLg works; on CI use `xvfb-run -a npm run test:extension`). The runtime libraries Electron needs
(`libnss3`, `libgbm1`, `libasound2`, `libxcomposite1`, `libxdamage1`, `libxrandr2`, `libxss1`) are
present on Ubuntu 24.04 desktop images.

### Visual harness

`FTM_VISUAL=1 npm run test:extension` additionally opens the demo file's history in the real
window, inspects the live webview DOM through the Chromium DevTools Protocol (VS Code is launched
with `--remote-debugging-port`), **asserts scroll synchronisation numerically** (every card must
be centred on the same logical line) and stores screenshots in `.vscode-test/shots`
(`FTM_SHOT_DIR` to change). `FTM_THEME="Light Modern"` (a theme _settings id_, e.g. `Dark Modern`,
`Light Modern`) selects the theme through seeded user settings; the run logs the effective theme
kind so a wrong id is visible.

## Smoke test (reproducible)

1. `npm run build && npm run package` → `file-time-machine-<version>.vsix`.
2. `code --install-extension file-time-machine-<version>.vsix` (from WSL this installs into the
   WSL remote; on Windows into the local VS Code). Reload the window.
3. `npm run demo-repo -- /path/to/demo --force` creates a repository with 20 commits on
   `src/services/UserService.ts` (rename, merge, uncommitted change) plus PHP/Python/JSON/text
   samples.
4. Open the demo folder, open `src/services/UserService.ts`, run
   **File Time Machine: Open File History** (Ctrl+Alt+H, editor title icon or context menu).
5. Check: the Working Tree card is in front (uncommitted change), the older cards peek below
   with their footer (hash · subject · author · date); when an older revision is active, the
   newer one peeks above with its header.
6. Travel: `J`/`K`, PageDown/PageUp, Alt+↑/↓, Alt+wheel, click a peeking card, click the
   timeline. Transition ≈200 ms (none with reduced motion).
7. Scroll the active card: neighbours keep the same logical region (e.g. the `validate()`
   function stays aligned across revisions where 20 lines were added above it).
8. Go back to "Move UserService into src/services": the history continues across the rename and
   the header shows `renamed from UserService.ts`.
9. Use header actions: copy message, open revision (read-only editor), compare with working tree.
10. `git status` in the demo repository is unchanged (read-only guarantee).

## Manual matrix

| Area         | Cases                                                                                                       | Status (2026-09-01)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------ | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| OS           | Windows (VS Code desktop), Linux/WSL (VS Code remote)                                                       | WSL: verified with the visual harness; Windows: pending user run                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Theme        | Dark Modern, Light Modern, High Contrast                                                                    | Dark and Light Modern verified via harness screenshots (Dark+/Light+ palettes, VS Code colour tokens). **High Contrast: pending manual check** — the test instance keeps rendering the dark theme even with `workbench.colorTheme: "Default High Contrast"` and `window.autoDetectHighContrast: false`, so the harness could not capture it. The UI only uses `--vscode-*` tokens plus HC-specific outlines (`body.vscode-high-contrast`), and highlighting switches to the GitHub high-contrast palettes by theme kind. |
| Languages    | TypeScript, PHP, Python, JSON, plaintext                                                                    | TS/PHP/Python/JSON highlighted (integration tests); plaintext renders unhighlighted                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Repositories | 1 commit, 10 commits, 100 commits, rename, large file, uncommitted changes, multi-root                      | 1/8/21/100 commits, rename ×2, 3000-line file, working tree entry, multi-root covered by automated tests                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Edge cases   | binary, deleted file, merge commit, CRLF, empty repository, untracked file, staged new file, file too large | covered by integration tests + empty-state UI                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

Items marked pending must be re-checked by a human before publishing to the Marketplace.
