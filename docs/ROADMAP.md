# Roadmap

Everything below is **post-MVP**. The MVP (this release) is: File History with layered
revisions, synchronized line mapping, continuous navigation, timeline, ghost lines, syntax
highlighting and read-only actions. See `README.md` for what ships today.

## Guiding question

> Does this help a developer understand faster how the code reached its current state?

If the answer is no, it does not belong in the product. We are not building a Git client and we
are not replicating GitLens or the Source Control view.

## Next phase (recommended): Selection History

`File Time Machine: Open Selection History` — select a function or block, and travel through
the commits that touched **those lines** (`git log -L <start>,<end>:<path>`). The session,
protocol and deck are already agnostic of _why_ a set of revisions is listed; the work is a
history provider that parses `-L` output (which embeds diffs) and a way to keep the anchor on the
selected region.

## Later

- **Function History** — resolve the symbol at the cursor (document symbols / AST) and follow it
  across renames of the function itself.
- **Staged vs unstaged** — split the working-tree pseudo revision into `Working Tree` and
  `Staged` (`git show :path`).
- **Blame overlay** — "who changed this line?" as a gutter overlay on the active card, using the
  existing per-revision line maps instead of `git blame`.
- **Search history** — find when a text first appeared / disappeared (`git log -S`, `-G`).
- **Heatmap** — a density strip showing which regions of the file change most often, computed
  from the maps already in memory.
- **Commit playback** — `▶ Play history` auto-advances through revisions at a chosen pace.
- **Branch comparison** — deck for the same file on two branches.
- **Semantic mapping** — tree-sitter/AST anchors (functions, classes, methods) feeding the
  LineMappingEngine, improving alignment for moved blocks and large rewrites.
- **Follow active editor** — optional toggle to retarget the panel when the active editor changes.
- **User theme colours** — if VS Code exposes token colours to extensions, replace the Dark+/
  Light+ palettes with the user's theme.
- **Image diff** for binary revisions (side-by-side thumbnails).

## Explicitly out of scope

Committing, staging, rebasing or any write operation; replacing the SCM view; telemetry.
