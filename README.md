# Code Time Machine — Visual Git History

Travel through a file's Git history instead of reading it one diff at a time.

Code Time Machine opens a file's history as a **deck of revisions**: the selected revision is in
front, the newer one peeks above, the older ones stack below. Scroll through time with
<kbd>Alt</kbd>+wheel or <kbd>J</kbd>/<kbd>K</kbd>, and the cards behind stay aligned on the **same
logical region of the code** — even when 100 lines were added above it — thanks to a line-mapping
engine. Added lines light up, removed lines linger as ghosts where they used to be.

> Placeholder for the demo GIF: `docs/media/demo.gif` (deck travelling through
> `UserService.ts`, showing synchronized scrolling and ghost lines).

## Why

The usual flow — history view → pick a commit → open the diff → go back → pick another → compare
mentally — is slow and loses the thread. This extension answers, at a glance:

- what changed here, and when did this function appear?
- what was here before, and who changed it?
- which code disappeared, and which parts were rewritten?

It is deliberately **not** another Git client: no committing, no staging, no branch management.
Everything is read-only.

## Usage

1. Open a file that is tracked by Git.
2. Run **Visual Git History: Open File History** (Command Palette, editor title icon
   <kbd>⟲</kbd>, editor/explorer context menu, or <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>H</kbd>).
3. Travel:

| Action                        | Input                                                                                                                                                                             |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Older / newer revision        | <kbd>Alt</kbd>+wheel · <kbd>J</kbd> / <kbd>K</kbd> · <kbd>PageDown</kbd> / <kbd>PageUp</kbd> · <kbd>Alt</kbd>+<kbd>↓</kbd> / <kbd>↑</kbd> · toolbar arrows · click a peeking card |
| Jump                          | click the timeline · **Go to Revision…** command · <kbd>Alt</kbd>+<kbd>Home</kbd> / <kbd>End</kbd>                                                                                |
| Scroll the file               | plain wheel / trackpad — neighbouring revisions follow the same logical lines                                                                                                     |
| Toggle ghost lines / timeline | toolbar buttons                                                                                                                                                                   |
| Refresh                       | <kbd>R</kbd> or toolbar                                                                                                                                                           |

Header actions on the active card: copy hash (click the hash chip), copy message, open the
revision in a read-only editor, compare with the working tree (VS Code diff editor).

The working tree appears as the first card when the file differs from HEAD. Renames are
followed; merge commits are shown against their first parent and labelled.

## Commands

| Command                                                                   | Description                                                                       |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `Visual Git History: Open File History`                                   | Open the deck for the active file                                                 |
| `Visual Git History: Previous Revision (Older)` / `Next Revision (Newer)` | Travel (also <kbd>Alt</kbd>+<kbd>↓</kbd>/<kbd>↑</kbd> while the panel is focused) |
| `Visual Git History: Go to Revision…`                                     | Quick pick over the loaded history                                                |
| `Visual Git History: Refresh`                                             | Reload history and working tree                                                   |
| `Visual Git History: Open Active Revision in Editor`                      | Read-only document of that revision                                               |
| `Visual Git History: Compare Active Revision with Working Tree`           | Native diff editor                                                                |
| `Visual Git History: Show Output Log`                                     | Diagnostics ("Visual Git History" output channel)                                 |

## Settings

| Setting                               | Default | Meaning                                                            |
| ------------------------------------- | ------- | ------------------------------------------------------------------ |
| `visualGitHistory.maxCommits`         | 500     | Maximum commits loaded (in growing pages)                          |
| `visualGitHistory.preloadRevisions`   | 3       | Revisions preloaded on each side of the active one                 |
| `visualGitHistory.animationDuration`  | 200     | Transition duration in ms (0 disables; reduced motion is honoured) |
| `visualGitHistory.showGhostLines`     | true    | Show removed lines as ghosts                                       |
| `visualGitHistory.followRenames`      | true    | Follow the file across renames                                     |
| `visualGitHistory.ignoreWhitespace`   | false   | Ignore whitespace-only changes when diffing/mapping                |
| `visualGitHistory.maxFileSizeKB`      | 2048    | Larger revisions are not rendered                                  |
| `visualGitHistory.maxRenderedLines`   | 8000    | Above this, simplified mode (no highlighting, no animation)        |
| `visualGitHistory.timeTravelModifier` | `alt`   | Modifier for wheel time travel (`alt`, `ctrl`, `shift`)            |

## Privacy

Everything runs locally against your Git repository through the built-in Git extension and the
`git` executable. No network requests, no telemetry, no analytics. The extension never writes to
your repository.

## Requirements and limitations

- VS Code ≥ 1.100 with the built-in Git extension enabled and `git` installed.
- Syntax colours come from VS Code's default themes (Dark+/Light+/high contrast) for the current
  theme kind, not from your custom theme.
- Binary files are detected but not visualised; very large revisions open in simplified mode or
  are skipped (see settings).
- `git log --follow` semantics apply: copies of similar files may inherit history; a rename
  combined with a heavy rewrite may break the trail.
- Staged changes are not separated from unstaged ones yet (Working Tree vs HEAD).

## Development

```
npm install
npm run watch          # esbuild in watch mode; F5 launches the Extension Development Host
npm run check          # lint + typecheck + unit/integration/webview tests + build
npm run test:extension # tests inside VS Code (downloads VS Code; needs a display or xvfb)
npm run package        # produces code-time-machine-<version>.vsix
npm run demo-repo -- ../code-time-machine-demo   # 20-commit demo repository
```

Documentation: [Architecture](docs/ARCHITECTURE.md) · [Line mapping](docs/LINE_MAPPING.md) ·
[Testing](docs/TESTING.md) · [Performance](docs/PERFORMANCE.md) · [Roadmap](docs/ROADMAP.md).

## License

MIT
