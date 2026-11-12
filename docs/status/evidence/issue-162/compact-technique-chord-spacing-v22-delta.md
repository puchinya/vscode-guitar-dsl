# Implementation Contract v22 Delta — レンダリング後の奏法・コード名間隔

- Repository: `puchinya/vscode-guitar-dsl`
- Issue: [#162](https://github.com/puchinya/vscode-guitar-dsl/issues/162)
- PR: [#163](https://github.com/puchinya/vscode-guitar-dsl/pull/163)
- Canonical v21: Issue #162 comment [`6714477721`](https://github.com/puchinya/vscode-guitar-dsl/issues/162#issuecomment-6714477721), 4,996 bytes, SHA-256 `a31920a8702396741f9008186eb93acf880eda9add7a844b77a0e5e9d40182eb`.
- A live screenshot measurement found only 3.65 CSS px between rendered technique marks and chord-name text with v21's 12px gutter. This delta replaces that gutter with a value that meets the painted-bounds requirement.

> This document is an Implementation Contract. Do not redesign the architecture during implementation. If a requirement conflicts with repository reality or requires a material design change, report the exact conflict and continue only with independent valid work.

## 1. Decision

In compact Practice Guide cards, reserve a 20 CSS px vertical gutter after the technique lane and before the chord-name lane whenever both contain visible items. After layout and any page scaling, measure rendered bounds and retain at least 10 CSS px between every visible technique mark (including stroke) and chord-name text.

Keep the gap stable for all four compact measure slots, grids 4/8/16, viewport widths 320/400/421/480/600/1100/1600 CSS px, melody on/off, lyric-present/absent pages, and both visible banks during page/fade changes. Move the chord-name lane, diagram lane, and card bottom down by the gutter. Preserve technique-lane height, chord-name fitting, diagram size and complete visibility, melody/lyric geometry, musical Fraction/x anchors, chord/technique identity, v20 wave/arrow clearance, and playback behavior. No code diagram or card bottom may be clipped.

Detailed Practice Guide layout, score SVG/PDF, GuitarDSL, and audio are unchanged.

## 2. Concrete Tests

1. In the live compact SVG, measure the painted bounds of visible technique marks (including stroke) against chord-name text after the final layout. Require at least 10 CSS px separation when both exist, and verify the lane gutter is 20 CSS px across the required width, grid, melody, lyric, page, and bank states.
2. Verify the lane shift preserves all four cards, code-name text and accessibility metadata, full chord diagrams, technique event/Fraction metadata, v20 wave/arrow clearance, and page/fade geometry.
3. Capture and visually inspect the current-source 16-image JA/EN × Light/Dark × 400/600px × grid8/grid16 matrix. Each sidecar records painted technique-to-chord clearance, lane gutter, complete diagram/card bounds, and PNG SHA-256.
4. Run configured repository gates and report failures exactly.

## 3. Document Impact

| Owner | Files | Change |
|---|---|---|
| Specification | `docs/specs/gui_design.md`, `docs/specs/extension.md` | Supersede v21's 12px proposal with a 20px gutter and 10px rendered-clearance requirement. |
| Design | `docs/design/preview-rendering-and-export.md` | Record the measured technique-mark / chord-name clearance and lane shift. |
| Help | EN/JA feature help, `help-manifest.json`, generated `media/help/` | Describe the visible separation in Practice Guide help. |
| Status / evidence | `docs/status/implementation-status.md`, `docs/status/evidence/issue-162/README.md`, v22 delta | Record current implementation, screenshots, and verification. |

## 4. Verification

Run `npm run compile:all`, `npm run test:unit`, `npm test`, `npm run check:help`, `npm run check:ai`, `npm run vscode:prepublish`, `python3 -m agent_workflow verify-implementation-contract 162`, `python3 -m agent_workflow validate-docs --issue 162`, `git diff --check`, required PR CI, current-HEAD self-review, and the repository delivery check. Run VS Code/Electron and GitHub operations outside the command sandbox. Report exact results, including unrelated full-suite failures.

## 5. Reviewer Checklist

- [ ] Compact cards reserve a 20px gutter and retain at least 10 CSS px between painted technique marks and chord-name text after rendering.
- [ ] The gap is stable across width/grid/lyric/melody/page/bank states.
- [ ] Code names, complete chord diagrams, all four measure cards, timing anchors, accessible labels, and playback geometry remain intact.
- [ ] v20 wave/arrow visual separation remains satisfied.
- [ ] The 16 current-source screenshots and sidecars show the measured clearance and complete content.
- [ ] Detailed layout, score SVG/PDF, DSL, and audio remain unchanged.
- [ ] Every other approved requirement and repository delivery gate is current-HEAD verified.
