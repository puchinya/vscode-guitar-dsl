# Implementation Contract v19 Delta — 矢印と波線の視認できる間隔

- Repository: `puchinya/vscode-guitar-dsl`
- Issue: [#162](https://github.com/puchinya/vscode-guitar-dsl/issues/162)
- PR: [#163](https://github.com/puchinya/vscode-guitar-dsl/pull/163)
- Canonical v18: Issue #162 comment [`6710718289`](https://github.com/puchinya/vscode-guitar-dsl/issues/162#issuecomment-6710718289), 4,379 bytes, SHA-256 `920e43f683f3232dfdc2e9e6f656be8218607efc405d90b46d02be6556ccb2ae`.
- This delta supersedes only compact grid8/grid16 wave sizing and visual placement. Preserve v18's 6px technique-to-chord-name gutter and all other approved requirements.
- User direction: the arrow and `〜` must not look attached; leave visible space between them.

> This document is an Implementation Contract. Do not redesign the architecture during implementation. If a requirement conflicts with repository reality or requires a material design change, report the exact conflict and continue only with independent valid work.

## 1. Decision

For compact grid8 and grid16 continuation waves, keep the selected Fraction, independent SVG node, common wide master path, path shape, height, stroke, and painter order. Keep attack arrows and their natural 4×30 paths at their semantic beat positions. Change only the wave's horizontal display rectangle so the wave is visibly separated from nearby arrows.

For each wave, calculate:

```text
cell = max(0, slotWidth - 4) / (measureBeats * (grid / 4))
displayWidth = min(cell, max(2.4, cell - 3.8))
visualLeft = anchorX + 0.325 * cell - displayWidth / 2
```

Clamp `visualLeft` to `[0, slotWidth - displayWidth]`. Keep the full semantic Fraction and anchor metadata unchanged. Do not move attacks, PM annotations, chord names, or measure boundaries. Do not alter grid4 waves, tie waves, detailed timeline, score SVG/PDF, DSL, or audio.

The wave path remains 30 CSS px high with its existing stroke and `vector-effect="non-scaling-stroke"`; only its horizontal display width and visual left edge change. Every painted wave stays within its grid cell and measure card. Arrows remain in front of waves and PM remains in front of both.

## 2. Concrete Tests

1. Measure stroke-inclusive SVG wave bounds and visible real attack bounds in the live compact banks. Require at least 3.0 CSS px clearance for grid8 and grid16 at 400px and 600px, zero contact/crossing at 320/421/480/840/1100/1600px, and no synthetic test-only attack in the real-event clearance oracle.
2. Keep every required wave Fraction/count and accessible name; verify path shape, at least 7px painted height, natural arrow width, card bounds, and at least 0.25px between neighboring grid16 waves at 320/400/421/600px.
3. Capture and visually inspect the 16-image JA/EN × Light/Dark × 400/600px grid8/grid16 matrix from current source. Sidecars record actual wave/arrow clearance, wave/wave clearance, card/next-chord bounds, dimensions, and PNG SHA-256.
4. Preserve v18's exact 6px technique-to-chord-name gap and all other v18 acceptance checks. Run the configured repository gates and report any failure without calling it PASS.

## 3. Document Impact

| Owner | Files | Change |
|---|---|---|
| Specification | `docs/specs/gui_design.md`, `docs/specs/extension.md` | Specify the centered narrow wave rectangle and minimum visible arrow clearance. |
| Design | `docs/design/preview-rendering-and-export.md` | Record visual spacing independently from musical anchors and painter order. |
| Help | EN/JA feature help, `help-manifest.json`, generated `media/help/` | Review Practice Guide wording and refresh the reviewed digest. |
| Status / evidence | `docs/status/implementation-status.md`, `docs/status/evidence/issue-162/README.md`, v19 delta | Record implementation, measured screenshots, and verification. |

## 4. Verification

Run `npm run compile:all`, `npm run test:unit`, `npm test`, `npm run check:help`, `npm run check:ai`, `npm run vscode:prepublish`, `python3 -m agent_workflow verify-implementation-contract 162`, `python3 -m agent_workflow validate-docs --issue 162`, `git diff --check`, required PR CI, current-HEAD self-review, and the repository delivery check. Run VS Code/Electron and GitHub operations outside the command sandbox. Report exact results, including any pre-existing or unrelated full-suite failure.

## 5. Reviewer Checklist

- [ ] Stroke-inclusive wave and arrow bounds are at least 3px apart at 400/600px and do not touch across the required width sweep.
- [ ] Waves retain their original timing, Fraction, node count, shape, height, stroke, and accessible identity.
- [ ] Wave width remains within its cell/card, and neighboring grid16 waves retain at least 0.25px painted clearance.
- [ ] Arrows remain uncompressed and visually in front; PM remains in front of both.
- [ ] The 16 current-source screenshots and sidecars show the new spacing and preserve the v18 6px lane gutter.
- [ ] Every other v18 requirement and repository delivery gate is current-HEAD verified.
