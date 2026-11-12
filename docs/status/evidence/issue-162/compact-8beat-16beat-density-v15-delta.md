# Implementation Contract v15 Delta — grid8・600pxでの波線と矢印の重なり

- Repository: `puchinya/vscode-guitar-dsl`
- Issue: [#162](https://github.com/puchinya/vscode-guitar-dsl/issues/162)
- PR: [#163](https://github.com/puchinya/vscode-guitar-dsl/pull/163)
- Canonical v14: Issue #162 comment [`6706690980`](https://github.com/puchinya/vscode-guitar-dsl/issues/162#issuecomment-6706690980), 20,538 bytes, SHA-256 `b4475127dc38ea2afa59785e62a9a12f627223d8f46281fc8376241f73735ab9`.
- This delta **supersedes only** the v14 compact grid8/grid16 continuation wave visual-left coefficient and the corresponding 600px grid8 overlap acceptance. All other v14, v13, and earlier requirements remain authoritative.
- The user approved keeping wave/attack horizontal bounds overlapping at both 400px and 600px. This change does not use the two new chat images as GitHub attachments; the existing reference crop and prior v14 reference-role mapping remain unchanged.

> This document is an Implementation Contract. Do not redesign the architecture during implementation. If a requirement conflicts with repository reality or requires a material design change, report the exact conflict and continue only with independent valid work.

## 1. Decision

For compact grid8 and grid16 continuation marks, keep every v14 event, Fraction, wave width, master path, painter order, stroke width, and clamp rule. Change only the painted horizontal origin from `anchorX - 0.72*cell` to:

```text
visualLeft = anchorX - 0.90*cell
```

The wave display width remains `max(2.8, cell-0.9)`, with `cell=max(0,slotWidth-4)/(measureBeats*(grid/4))`. Clamp only the painted rectangle to the card; keep the semantic anchor and event time unchanged. Do not stretch or move arrows, change their 4×30 natural path, or shift any Fraction.

At the 600px Preview viewport, the compact stage is 504px wide beside the existing 96px next-chord column. Each card is 126px, so grid8 `cell=(126-4)/8=15.25px`. With the fixed 5.6-wide master path, the left painted wave bound is approximately 1.98px after the quarter-note arrow's x anchor, inside its 4px horizontal bounds; the overlap is approximately 2.02px. At a 400px stage, the same calculation gives approximately 2.58px of overlap. These calculations are design estimates; acceptance uses real rendered DOM bounds.

The coefficient change moves every wave in a selected grid by the same relative offset. It therefore leaves wave-to-wave painted gaps, Fraction positions, waveform silhouette, display width, vertical curvature, and actual stroke width unchanged. Arrows remain in the foreground; wave contact must not obscure arrowheads or PM runs.

## 2. Required Runtime Semantics

- Keep the v14 5.6×30 path `M0.40 15 C1.15 10.8 2.00 10.8 2.80 15 S4.45 19.2 5.20 15`, X-only stretching, `preserveAspectRatio="none"`, `vector-effect="non-scaling-stroke"`, 1.15 CSS px stroke, and `Y scale=1` for both grid8 and grid16.
- Keep painter order waves → attacks → PM. Preserve one accessible wave node per required Fraction, exact event identity, `data-guide-at-fraction`, playback highlighting, and grid-switch/resize synchronization in both banks.
- Keep each painted wave within its measure card. Do not overlap chord labels, barlines, or PM runs; do not fully obscure a stroke arrow. Adjacent grid16 wave paths retain at least 0.25px painted clearance at 320/400/421/600px.
- No changes to score time, playback, attack paths, stroke natural size, compact page capacity, code diagrams, lyrics, melody, bank gaps, next-chord aside, or fade lifecycle.

## 3. Concrete Tests

1. **Grid8, 400px and 600px:** use quarter-note attacks and eighth continuations. In each width, measure painted wave path bounds (including stroke) and real attack bounds. Assert overlap `>0`, arrows remain in the attack painter above waves, every arrow has its natural 4px width, and all required wave counts/Fractions remain present.
2. **Grid16, 320/400/421/600px:** retain exact wave counts/Fractions, common master path, painted height ≥7px, stroke width ≥1px, wave/arrow overlap, wave-wave painted gap ≥0.25px, and no collision with PM/chord regions.
3. **Resize/grid switching:** `grid8→grid16→grid8` and `400→600→400→1100`; both template/live banks recompute the same painted positions from the unchanged semantic anchor without stale widths or duplicate nodes.
4. **Screenshots:** capture JA/EN × Light/Dark × 400/600px for grid8 and grid16 (16 PNGs and JSON sidecars). Include viewport/stage/card bounds, arrow bounds, painted wave bounds, overlap counts, wave gaps, PNG dimensions and SHA-256. No auxiliary panel may cover the fourth card or next-chord region.
5. Preserve and rerun all non-wave v14 acceptance tests and the full repository verification gate. A prior full-suite failure is not considered resolved by focused E2E success.

## 4. Document Impact

| Owner | Files | Change |
|---|---|---|
| Specification | `docs/specs/gui_design.md`, `docs/specs/extension.md` | Update the compact grid8/grid16 visual-left coefficient to `0.90` and state the 400/600px overlap requirement. |
| Design | `docs/design/preview-rendering-and-export.md` | Document that the wave origin extends to `anchorX-0.90*cell`, while semantic time and other wave geometry remain fixed. |
| Status / evidence | `docs/status/implementation-status.md`, `docs/status/evidence/issue-162/README.md`, v15 delta | Record this delta and current-HEAD implementation, verification, and screenshot results. |
| Help | JA/EN feature help, `help-manifest.json`, generated `media/help/` | Review wording and refresh the digest/generated help if the reviewed source changes. |

## 5. Verification

Run `npm run compile:all`, `npm run test:unit`, `npm test`, `npm run check:help`, `npm run check:ai`, `npm run vscode:prepublish`, `python3 -m agent_workflow verify-implementation-contract 162`, `python3 -m agent_workflow validate-docs --issue 162`, `git diff --check`, required PR CI, current-HEAD self-review, and the repository delivery check. Run commands that launch VS Code/Electron and GitHub operations outside the command sandbox. Report the exact result for each gate; do not call an unrun or failed gate PASS.

## 6. Reviewer Checklist

- [ ] v14 is preserved except for the explicitly superseded visual-left coefficient and 600px grid8 overlap acceptance.
- [ ] Real painted wave bounds overlap a natural 4px arrow at grid8 at both 400px and 600px.
- [ ] Arrows remain visible and above the waves; wave/PM/chord/barline exclusions hold.
- [ ] Wave count, Fractions, event identity, master `d`, height, stroke width, wave gaps, and semantic anchors are unchanged.
- [ ] All 16 current-HEAD screenshots and JSON sidecars are unoccluded, dimension-checked, SHA-linked, and visually inspected.
- [ ] All v14 non-wave acceptance checks and repository delivery gates are current-HEAD verified.
