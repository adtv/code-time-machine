# Changelog

## 0.2.2 — 2026-09-01

- Change counter fix: the current block is now the one whose clamped scroll target is closest to
  the scroll position (same maths as the jumps), so the footer reads N/N at the bottom of the
  file and 1/N at the top — blocks in the first/last half viewport were previously unreachable
  by the "nearest to centre" metric.

## 0.2.1 — 2026-09-01

- Distinctive launch icon: `$(versions)` (stacked revisions) instead of `$(history)`, which
  collided visually with other Git history extensions in the editor title bar.

## 0.2.0 — 2026-09-01

- New launch point: right-click on an editor tab (editor title context menu).
- Change-block navigation: footer control `‹ k/n changes ›`, keys N/P and F7/Shift+F7 centre the
  code on the previous/next hunk (synchronised with the neighbouring cards); minimap change
  markers are stronger (solid gutter bar + tint, red line for hidden deletions); footer shows the
  time elapsed since the previous revision.

- Minimap on the active revision card (canvas): scaled code picture with token colours, added and
  removed lines tinted, slider for the visible region; click, drag and wheel to scroll. Setting
  `visualGitHistory.showMinimap` and a toolbar toggle.
- Responsive layout: header/footer truncation with container queries, compact timeline with short
  sticky day labels on narrow panels; sticky day headers no longer let items show above them.

## 0.1.0 — 2026-09-01

Initial MVP.

- Visual file history: layered revision deck (newer above, active in front, older below) with
  animated, reduced-motion-aware transitions.
- Synchronized scrolling through a line-mapping engine (patience/Myers diff, similarity pairing,
  confidence and graceful degradation).
- Added lines and ghost (removed) lines rendered in place; toggleable.
- Timeline with day groups, change magnitude, merge/working-tree markers and paging.
- Working tree pseudo revision, rename following, merge commits against first parent, binary /
  deleted / too-large states, multi-root workspaces.
- Syntax highlighting (Shiki) in a worker thread, themed by VS Code theme kind.
- Read-only actions: copy hash/message, open revision in editor, compare with working tree.
- Keyboard: J/K, PageUp/PageDown, Alt+↑/↓, Alt+Home/End, R; Alt+wheel time travel.
