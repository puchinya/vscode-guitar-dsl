# Implementation Contract v21 Delta — 奏法記号とコード名の視覚的な間隔

- Repository: `puchinya/vscode-guitar-dsl`
- Issue: [#162](https://github.com/puchinya/vscode-guitar-dsl/issues/162)
- PR: [#163](https://github.com/puchinya/vscode-guitar-dsl/pull/163)
- Canonical v20: Issue #162 comment [`6711338415`](https://github.com/puchinya/vscode-guitar-dsl/issues/162#issuecomment-6711338415), 4,735 bytes, SHA-256 `3681cf78d05fa56f2c238c5c742119125ea1379f83b7ff00760d7c4af8a71475`.
- This delta replaces only v20's 6px compact technique-to-chord lane gutter. It makes the visible whitespace between stroke marks and chord-name text measurable; every other approved requirement remains in force.

> This document is an Implementation Contract. Do not redesign the architecture during implementation. If a requirement conflicts with repository reality or requires a material design change, report the exact conflict and continue only with independent valid work.

## 1. Decision

In compact Practice Guide cards, show a visible vertical gap between the rendered stroke-pattern marks and chord-name text. Reserve a 12 CSS px layout gutter after the technique lane and before the chord-name lane whenever both lanes contain visible items. This must result in at least 10 CSS px between the painted technique-mark bounds (including stroke) and chord-name text bounds.

Apply the same spacing to all four compact measure slots, grids 4/8/16, viewport widths 320/400/421/480/600/1100/1600 CSS px, melody on/off, lyric-present/absent pages, and both visible banks during page/fade changes. The gap is stable for every measure in the rendered bank.

Move the chord-name lane, diagram lane, and card bottom down by the reserved gutter. Preserve technique-lane height, chord-name font fitting, diagram size and complete bounds, melody/lyric geometry, musical Fraction/x anchors, chord/technique identity, wave/arrow clearance, and all playback behavior. Do not clip code diagrams or the lower edge of a card.

Detailed Practice Guide layout, score SVG/PDF, GuitarDSL, and audio are unchanged.

## 2. Concrete Tests

1. In the live compact SVG, measure the painted bounds of visible technique marks (including stroke) against chord-name text bounds for every card. Require at least 10 CSS px vertical separation when both exist, and verify the compact lane gutter is 12 CSS px across the required width, grid, melody, lyric, page, and bank states.
2. Verify the 12px shift preserves all four cards, code-name text and accessibility metadata, full code diagrams, technique event/Fraction metadata, v20's wave/attack clearance, and page/fade geometry.
3. Capture and visually inspect the current-source 16-image JA/EN × Light/Dark × 400/600px × grid8/grid16 matrix. Record painted technique-to-chord clearance, lane gutter, complete diagram/card bounds, and PNG SHA-256 in each sidecar.
4. Keep v20's 3px wave/arrow minimum at 400/600px and positive clearance at all other required widths. Run configured repository gates and report failures exactly.

## 3. Document Impact

| Owner | Files | Change |
|---|---|---|
| Specification | `docs/specs/gui_design.md`, `docs/specs/extension.md` | Supersede the compact 6px gutter with the 12px gutter and 10px painted-clearance requirement. |
| Design | `docs/design/preview-rendering-and-export.md` | Record the measured technique-mark / chord-name clearance and lane shift. |
| Help | EN/JA feature help, `help-manifest.json`, generated `media/help/` | Review Practice Guide wording and refresh the reviewed digest if its source changes. |
| Status / evidence | `docs/status/implementation-status.md`, `docs/status/evidence/issue-162/README.md`, v21 delta | Record current implementation, screenshots, and verification. |

## 4. Verification

Run `npm run compile:all`, `npm run test:unit`, `npm test`, `npm run check:help`, `npm run check:ai`, `npm run vscode:prepublish`, `python3 -m agent_workflow verify-implementation-contract 162`, `python3 -m agent_workflow validate-docs --issue 162`, `git diff --check`, required PR CI, current-HEAD self-review, and the repository delivery check. Run VS Code/Electron and GitHub operations outside the command sandbox. Report exact results, including unrelated full-suite failures.

## 5. Reviewer Checklist

- [ ] Compact cards provide at least 10 CSS px between painted stroke-pattern marks and chord-name text, measured from rendered bounds.
- [ ] The compact lane gutter is 12 CSS px across width/grid/lyric/melody/page/bank states.
- [ ] Code names, complete chord diagrams, all four measure cards, timing anchors, accessible labels, and playback geometry remain intact.
- [ ] v20 wave/arrow visual separation remains satisfied.
- [ ] The 16 current-source screenshots and sidecars show the measured clearance and complete content.
- [ ] Detailed layout, score SVG/PDF, DSL, and audio remain unchanged.
- [ ] Every other approved requirement and repository delivery gate is current-HEAD verified.
