# Line Mapping

How File Time Machine keeps the _same logical region_ of a file aligned across revisions while
the user scrolls, even when lines were inserted, deleted or rewritten in between.

Source: `src/shared/diff/lineDiff.ts` (diff) and `src/shared/mapping/lineMap.ts` (mapping).
Both are pure TypeScript with no VS Code or Git dependency, so they are unit-tested exhaustively
(`tests/unit/lineDiff.test.ts`, `tests/unit/lineMap.test.ts`).

## 1. The problem

Scrolling the active card to line 420 must scroll the neighbouring cards to _the line that
corresponds to 420_, not to the same pixel offset or the same percentage. If 100 lines were
added at the top of the newer revision, line 420 of the new file is line 320 of the old one.

## 2. Pipeline

```
lines A, lines B
   │  normalise (strip CR; optional whitespace collapse) + intern to integers
   ▼
diffLines(A, B)  →  ops: equal | insert | delete | replace   (covers both inputs exactly)
   │
   ▼
buildLineMap(A, B, diff)  →  LineMap { aToB, bToA, confidence, type, overall, degraded }
   │
   ▼
mapLine(map, side, line) →  { line, confidence, direct }     (never fails, always in range)
composeLineMaps(ab, bc)  →  ac                                 (cards two steps away)
```

## 3. Diff algorithm

1. **Normalisation.** A trailing `\r` is always removed, so CRLF↔LF conversions never appear as
   changes. With `fileTimeMachine.ignoreWhitespace`, lines are trimmed and internal whitespace
   collapsed before comparison.
2. **Interning.** Each distinct normalised line gets an integer id; the rest of the algorithm
   compares integers only.
3. **Prefix/suffix trimming.** Common leading and trailing lines are emitted as `equal` at once.
4. **Patience anchors.** Inside the remaining window, lines that occur exactly once in both
   sides are candidate anchors. Their longest increasing subsequence (by position on both sides)
   is kept, which makes unique lines such as function signatures dominate and prevents braces,
   blank lines and `return` statements from producing misleading matches. The algorithm recurses
   between anchors.
5. **Bounded Myers.** A gap without any unique common line is diffed with Myers' O(ND) algorithm,
   bounded by `maxEditDistance` (default 1000 edits) and `maxMyersSegment` (6000 lines). When a
   bound is exceeded, the gap is emitted as one bulk `replace` and `LineDiff.degraded` is set.
   In practice this only happens for wholesale rewrites, where a bulk replace _is_ the right
   answer.
6. **Normalisation of ops.** Adjacent equal runs are merged; interleaved single-line inserts and
   deletes between two equal regions are folded into one `insert`, `delete` or `replace` block.

`applyOps(A, B, ops)` rebuilds B from A and the ops — the property tests use it to prove that
every produced diff is valid.

## 4. Mapping construction

| Diff op   | Mapping                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `equal`   | 1:1, type `unchanged`, confidence 1.                                                                                                                                                                                                                                                                                                                                                                                                 |
| `replace` | **Similarity pass**: lines are tokenised (identifiers/numbers, punctuation ignored) and paired greedily and monotonically by Sørensen–Dice similarity ≥ 0.6 → type `modified`, confidence = similarity. Blocks larger than 250 000 pairs skip this pass. **Interpolation pass**: remaining lines are placed by linear interpolation between their nearest paired neighbours (or block boundaries) → type `modified`, confidence 0.3. |
| `insert`  | b-lines with no counterpart: `bToA = -1`, type `inserted`.                                                                                                                                                                                                                                                                                                                                                                           |
| `delete`  | a-lines with no counterpart: `aToB = -1`, type `deleted`.                                                                                                                                                                                                                                                                                                                                                                            |

`overall` = (exact lines + Σ similarity of paired lines) / max(|A|, |B|). Below 0.15 the map is
flagged `degraded`; the UI then falls back to proportional scrolling and shows an
"approximate" badge. **No correspondence with confidence > 0.3 is ever invented.**

## 5. Resolving a line (`mapLine`)

- Direct mapping → returned with its confidence (`direct: true`).
- Otherwise (inserted/deleted line) → interpolate between the nearest mapped neighbours on the
  same side; with a single neighbour, extrapolate by distance; with none, use the proportional
  position. Confidence 0.2, `direct: false`. The result is clamped to a valid line index.

This is what the scroll-synchronisation controller calls with the line at the vertical centre
of the active card, for each visible neighbour.

## 6. Composition

Cards two steps away (N±2) use `composeLineMaps(N↔N±1, N±1↔N±2)`: a line maps through the
intermediate revision, confidences multiply, `unchanged` survives only if both hops are
unchanged, and `degraded` is the OR of both hops. Missing hops become `-1` and are resolved by
`mapLine`'s neighbour interpolation.

## 7. Edge cases covered by tests

Insertion (A), deletion (B), replacement with a stable signature (C), 100 lines prepended (D),
content appended (E), formatter/whitespace-only changes (F), CRLF→LF (G), full rewrite (H),
moved block (kept lines map exactly, moved lines are not fabricated), empty sides, out-of-range
input, composition through insert+delete, and randomised property tests (600 random pairs,
5 000-line file with 200 mutations diffed in well under 500 ms).

## 8. Limitations and future work

- Moved blocks are represented as delete + insert (no move detection); scrolling inside a moved
  block relies on neighbour interpolation.
- Similarity is token-set based; reordering tokens within a line still scores high, which is
  desirable for mapping but not a semantic equivalence.
- Roadmap: AST/tree-sitter based semantic anchors (functions, classes) to map symbols rather than
  lines, see `docs/ROADMAP.md`.
