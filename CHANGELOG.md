# Changelog

## Unreleased

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
