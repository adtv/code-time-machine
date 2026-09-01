# File Time Machine — Visual Git History

Travel through a file's Git history instead of reading it one diff at a time.

File Time Machine opens a file's history as a **deck of revisions**: the selected revision is in
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
2. Run **File Time Machine: Open File History** (Command Palette, editor title icon
   <kbd>⟲</kbd>, editor/explorer context menu, or <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>H</kbd>).
3. Travel:

| Action                                  | Input                                                                                                                                                                             |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Older / newer revision                  | <kbd>Alt</kbd>+wheel · <kbd>J</kbd> / <kbd>K</kbd> · <kbd>PageDown</kbd> / <kbd>PageUp</kbd> · <kbd>Alt</kbd>+<kbd>↓</kbd> / <kbd>↑</kbd> · toolbar arrows · click a peeking card |
| Jump                                    | click the timeline · **Go to Revision…** command · <kbd>Alt</kbd>+<kbd>Home</kbd> / <kbd>End</kbd>                                                                                |
| Scroll the file                         | plain wheel / trackpad — neighbouring revisions follow the same logical lines                                                                                                     |
| Jump between change blocks              | <kbd>N</kbd> / <kbd>P</kbd> · <kbd>F7</kbd> / <kbd>Shift</kbd>+<kbd>F7</kbd> · ‹ k/n › control in the footer · click a marker in the minimap                                      |
| Toggle ghost lines / minimap / timeline | toolbar buttons                                                                                                                                                                   |
| Refresh                                 | <kbd>R</kbd> or toolbar                                                                                                                                                           |

The active card has a **minimap** on its right edge: a scaled picture of the revision with a solid
green/red marker bar and tint where lines were added or removed (a red line marks deletions even
when ghost lines are hidden), so you can see _where_ a commit changed the file; click or drag it to
scroll. The footer counts the change blocks (`2/5 changes`) and its arrows — or <kbd>N</kbd> /
<kbd>P</kbd>, <kbd>F7</kbd> / <kbd>Shift</kbd>+<kbd>F7</kbd> — centre the code on the previous/next
block while the neighbouring revisions follow.

Header actions on the active card: copy hash (click the hash chip), copy message, open the
revision in a read-only editor, compare with the working tree (VS Code diff editor).

The working tree appears as the first card when the file differs from HEAD. Renames are
followed; merge commits are shown against their first parent and labelled.

## Commands

| Command                                                                  | Description                                                                       |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `File Time Machine: Open File History`                                   | Open the deck for the active file                                                 |
| `File Time Machine: Previous Revision (Older)` / `Next Revision (Newer)` | Travel (also <kbd>Alt</kbd>+<kbd>↓</kbd>/<kbd>↑</kbd> while the panel is focused) |
| `File Time Machine: Go to Revision…`                                     | Quick pick over the loaded history                                                |
| `File Time Machine: Refresh`                                             | Reload history and working tree                                                   |
| `File Time Machine: Open Active Revision in Editor`                      | Read-only document of that revision                                               |
| `File Time Machine: Compare Active Revision with Working Tree`           | Native diff editor                                                                |
| `File Time Machine: Show Output Log`                                     | Diagnostics ("File Time Machine" output channel)                                  |

## Settings

| Setting                              | Default | Meaning                                                                                     |
| ------------------------------------ | ------- | ------------------------------------------------------------------------------------------- |
| `fileTimeMachine.maxCommits`         | 500     | Maximum commits loaded (in growing pages)                                                   |
| `fileTimeMachine.preloadRevisions`   | 3       | Revisions preloaded on each side of the active one                                          |
| `fileTimeMachine.animationDuration`  | 200     | Transition duration in ms (0 disables; reduced motion is honoured)                          |
| `fileTimeMachine.showGhostLines`     | true    | Show removed lines as ghosts                                                                |
| `fileTimeMachine.showMinimap`        | true    | Minimap on the active revision (click/drag/wheel to scroll; added and removed lines tinted) |
| `fileTimeMachine.followRenames`      | true    | Follow the file across renames                                                              |
| `fileTimeMachine.ignoreWhitespace`   | false   | Ignore whitespace-only changes when diffing/mapping                                         |
| `fileTimeMachine.maxFileSizeKB`      | 2048    | Larger revisions are not rendered                                                           |
| `fileTimeMachine.maxRenderedLines`   | 8000    | Above this, simplified mode (no highlighting, no animation)                                 |
| `fileTimeMachine.timeTravelModifier` | `alt`   | Modifier for wheel time travel (`alt`, `ctrl`, `shift`)                                     |

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
npm run package        # produces file-time-machine-<version>.vsix
npm run demo-repo -- ../file-time-machine-demo   # 20-commit demo repository
```

Documentation lives in `docs/`: `ARCHITECTURE.md`, `LINE_MAPPING.md`, `TESTING.md`,
`PERFORMANCE.md`, `ROADMAP.md`.

## License

MIT
