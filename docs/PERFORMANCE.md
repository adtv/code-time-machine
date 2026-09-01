# Performance

Targets from the specification and what was measured on 2026-09-01 (WSL2, Ubuntu 24.04,
Node 24, git 2.43, 32 cores; numbers from `tests/integration/performance.test.ts` and
`tests/integration/highlight.test.ts`, which print them on every run).

## Targets vs measurements

| Scenario                                                                | Target                               | Measured                                                                                                |
| ----------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Open history (first page, 100 commits)                                  | < 500–800 ms                         | **68 ms** (`git log --follow` + parse)                                                                  |
| First window ready (active + 3 older views: content, diff, line maps)   | —                                    | **99 ms** cumulative from open                                                                          |
| Jump to a distant revision (7 new views)                                | < 50 ms perceptible before animation | **48 ms** total; the active view is sent first, so the animation starts as soon as it arrives           |
| Step to an adjacent revision (1 new view, others cached)                | < 50 ms                              | **7 ms**                                                                                                |
| Diff of two 3 000-line revisions (patience + Myers)                     | —                                    | **1 ms**                                                                                                |
| LineMap for the same pair (similarity + interpolation)                  | —                                    | **< 1 ms**                                                                                              |
| Syntax highlighting, 3 000 lines of TypeScript (Shiki, JS regex engine) | must not block the UI                | **165 ms**, executed in a worker thread; ~40 ms for a 200-line file                                     |
| Interaction (scroll sync, deck transition)                              | 60 fps                               | transforms/opacity only; scroll sync does one rAF per scroll event and touches `scrollTop` of ≤ 3 cards |

The demo repository (20 commits, ~70 lines) opens with the full window rendered in well under
100 ms on the same machine.

## Where the time goes and how it is bounded

- **Git**: one `git log --follow --raw --numstat -z` per page (pages grow geometrically
  100 → 300 → 700 … up to `maxCommits`), one `git cat-file -s` + `git cat-file blob` per revision
  content (cached by blob SHA, LRU with a 24 MiB budget). All processes are asynchronous and
  cancellable through `AbortSignal`; the extension host thread is never blocked by git.
- **Diff + mapping**: pure TypeScript on interned integer arrays; patience anchors keep the
  Myers search small. Hard bounds (`maxEditDistance` 1000, `maxMyersSegment` 6000 lines) turn
  pathological gaps into a bulk replace instead of quadratic work.
- **Highlighting**: runs in `dist/highlight-worker.js` (worker thread) with an LRU cache keyed by
  content hash + language + theme. Files above `maxRenderedLines` (default 8 000) skip
  highlighting ("simplified mode"). If the worker dies the UI degrades to plain text.
- **Webview**: each card renders only the visible rows (+20 overscan) with `textContent`; the
  deck holds at most 6 cards (4 visible + 2 fading). Payloads are compact: spans are
  `[text, paletteIndex]` tuples and line maps are plain integer arrays. Cards outside the window
  are evicted from the webview store.
- **Preload window**: `preloadRevisions` (default 3) revisions on each side of the active one are
  fetched in distance order; every active change aborts in-flight work for the previous window.

## Memory

- Content cache: ≤ 64 entries / 24 MiB estimated (UTF-16 size + per-line overhead).
- Highlight cache: ≤ 48 entries / 16 MiB estimated.
- Session views: active ± (2·preload + 1) revisions; everything else is dropped.
- Webview: `retainContextWhenHidden` keeps the rendered deck alive while the tab is hidden — a
  deliberate trade-off (memory for instant tab switching). Closing the panel disposes the
  session, aborts git processes and clears its views.

## Reproducing

```
npm run test:integration -- tests/integration/performance.test.ts --reporter=verbose
```

The synthetic repository has 100 commits on a ~3 000-line file where each commit touches ~1 % of
the lines and inserts a few. Numbers vary with disk speed and git version; the assertions are
loose safety nets, the printed timings are the measurement.
