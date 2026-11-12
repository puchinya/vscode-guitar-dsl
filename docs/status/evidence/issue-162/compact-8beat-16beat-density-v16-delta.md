# Implementation Contract v16 Delta — 矢印と波線の間隔

- Repository: `puchinya/vscode-guitar-dsl`
- Issue: [#162](https://github.com/puchinya/vscode-guitar-dsl/issues/162)
- PR: [#163](https://github.com/puchinya/vscode-guitar-dsl/pull/163)
- Canonical v15: Issue #162 comment [`6710138173`](https://github.com/puchinya/vscode-guitar-dsl/issues/162#issuecomment-6710138173), 6,901 bytes, SHA-256 `5912f329e84bfcd21807d2632d54f4800098345ef9cb1c5dea7a7b233345e7c6`.
- The user reviewed v15 screenshots and directed that stroke arrows and continuation waves must not touch. This delta supersedes only v15's wave-origin coefficient and wave/arrow overlap acceptance. Every other v15, v14, v13, and earlier requirement remains authoritative.

> This document is an Implementation Contract. Do not redesign the architecture during implementation. If a requirement conflicts with repository reality or requires a material design change, report the exact conflict and continue only with independent valid work.

## 1. Decision

For compact grid8 and grid16 continuation marks, preserve every v15 event, Fraction, wave width, master path, painter order, stroke width, and clamp rule. Change only the painted horizontal origin to:

```text
visualLeft = anchorX - 0.10*cell
```

The wave display width remains `max(2.8, cell-0.9)`, with `cell=max(0,slotWidth-4)/(measureBeats*(grid/4))`. Clamp only the painted rectangle to the card; keep the semantic anchor and event time unchanged. Do not stretch or move arrows, change their 4×30 natural path, or shift any Fraction.

The acceptance target is a **minimum 1.0 CSS px horizontal clearance** from every painted continuation-wave bound (including stroke) to every visible attack bound for grid8 and grid16 at 400px and 600px Preview widths. A zero gap or overlap fails. The current v15 DOM sidecars predict at least 1.74px at 400px and 2.12px at 600px for the tighter grid16 case with this coefficient; final acceptance must use newly rendered DOM measurements.

The coefficient change moves each wave to the right within its existing grid cell. It therefore leaves wave-to-wave painted gaps, Fraction positions, waveform silhouette, display width, vertical curvature, and actual stroke width unchanged. Arrows remain in the foreground. Wave paths must not touch arrows, PM runs, chord labels, or barlines.

## 2. Required Runtime Semantics

- Keep the v15 5.6×30 path `M0.40 15 C1.15 10.8 2.00 10.8 2.80 15 S4.45 19.2 5.20 15`, X-only stretching, `preserveAspectRatio="none"`, `vector-effect="non-scaling-stroke"`, 1.15 CSS px stroke, and `Y scale=1` for both grid8 and grid16.
- Keep painter order waves → attacks → PM. Preserve one accessible wave node per required Fraction, exact event identity, `data-guide-at-fraction`, playback highlighting, and grid-switch/resize synchronization in both banks.
- Keep each painted wave within its measure card. Do not overlap arrows, PM runs, chord labels, or barlines. Adjacent grid16 wave paths retain at least 0.25px painted clearance at 320/400/421/600px.
- No changes to score time, playback, attack paths, stroke natural size, compact page capacity, code diagrams, lyrics, melody, bank gaps, next-chord aside, or fade lifecycle.

## 3. Concrete Tests

1. **Grid8 and grid16, 400px and 600px:** measure painted wave path bounds including stroke and all real attack bounds. Assert at least 1.0px minimum horizontal clearance, arrows retain their natural 4px width, and all required wave counts/Fractions remain present.
2. **Grid16, 320/400/421/600px:** retain exact wave counts/Fractions, common master path, painted height ≥7px, stroke width ≥1px, wave/arrow clearance ≥1.0px, wave-wave painted gap ≥0.25px, and no collision with PM/chord regions.
3. **Resize/grid switching:** `grid8→grid16→grid8` and `400→600→400→1100`; both template/live banks recompute the same painted positions from the unchanged semantic anchor without stale widths or duplicate nodes.
4. **Screenshots:** capture JA/EN × Light/Dark × 400/600px for grid8 and grid16 (16 PNGs and JSON sidecars). Include viewport/stage/card bounds, arrow bounds, painted wave bounds, minimum clearance, wave gaps, PNG dimensions and SHA-256. No auxiliary panel may cover the fourth card or next-chord region. Visually inspect the current v16 captures.
5. Preserve and rerun all non-wave v15 acceptance tests and the full repository verification gate. A prior full-suite failure is not considered resolved by focused E2E success.

## 4. Document Impact

| Owner | Files | Change |
|---|---|---|
| Specification | `docs/specs/gui_design.md`, `docs/specs/extension.md` | Update the compact grid8/grid16 visual-left coefficient to `0.10` and require at least 1px of separation from attack bounds. |
| Design | `docs/design/preview-rendering-and-export.md` | Document that the wave origin is `anchorX-0.10*cell` and wave/arrow bounds remain separated. |
| Status / evidence | `docs/status/implementation-status.md`, `docs/status/evidence/issue-162/README.md`, v16 delta | Record this delta and current-HEAD implementation, verification, and screenshot results. |
| Help | JA/EN feature help, `help-manifest.json`, generated `media/help/` | Review wording and refresh the digest/generated help if the reviewed source changes. |

## 5. Verification

Run `npm run compile:all`, `npm run test:unit`, `npm test`, `npm run check:help`, `npm run check:ai`, `npm run vscode:prepublish`, `python3 -m agent_workflow verify-implementation-contract 162`, `python3 -m agent_workflow validate-docs --issue 162`, `git diff --check`, required PR CI, current-HEAD self-review, and the repository delivery check. Run commands that launch VS Code/Electron and GitHub operations outside the command sandbox. Report the exact result for each gate; do not call an unrun or failed gate PASS.

## 6. Reviewer Checklist

- [ ] v15 is preserved except for the explicitly superseded visual-left coefficient and wave/arrow overlap acceptance.
- [ ] Every measured grid8/grid16 wave and attack has at least 1.0px horizontal clearance at both 400px and 600px.
- [ ] Waves do not touch arrows; wave/PM/chord/barline exclusions hold.
- [ ] Wave count, Fractions, event identity, master `d`, height, stroke width, wave gaps, and semantic anchors are unchanged.
- [ ] All 16 current-HEAD screenshots and JSON sidecars are unoccluded, dimension-checked, SHA-linked, and visually inspected.
- [ ] All v15 non-wave acceptance checks and repository delivery gates are current-HEAD verified.
