# Implementation Contract v20 Delta — 400px grid16の矢印・波線間隔

- Repository: `puchinya/vscode-guitar-dsl`
- Issue: [#162](https://github.com/puchinya/vscode-guitar-dsl/issues/162)
- PR: [#163](https://github.com/puchinya/vscode-guitar-dsl/pull/163)
- Canonical v19: Issue #162 comment [`6711290975`](https://github.com/puchinya/vscode-guitar-dsl/issues/162#issuecomment-6711290975), 5,018 bytes, SHA-256 `32b1c47241b3f8a35346947fa9e55fbd057cd9f48f84ad0d4342e1e1918128ed`.
- This delta corrects only v19's sizing/placement formula, which cannot provide the required 3px gap at 400px/grid16. All v18 requirements and v19's visible-spacing intent remain authoritative.

> This document is an Implementation Contract. Do not redesign the architecture during implementation. If a requirement conflicts with repository reality or requires a material design change, report the exact conflict and continue only with independent valid work.

## 1. Decision

For compact grid8/grid16 continuation waves, preserve every Fraction, semantic anchor, independent SVG node, common wide master path, vertical shape, height, stroke, and painter order. Keep attack arrows at their semantic beat positions and at natural size.

For each wave, calculate:

```text
cell = max(0, slotWidth - 4) / (measureBeats * (grid / 4))
displayWidth = min(cell, max(2.2, cell - 3.8))
visualLeft = anchorX + cell / 3 - displayWidth / 2
```

Clamp `visualLeft` to `[0, slotWidth - displayWidth]`. Only the wave's horizontal visual rectangle changes. Do not move attacks, PM annotations, chord names, or measure boundaries. Do not alter grid4 waves, tie waves, detailed timeline, score SVG/PDF, DSL, or audio.

The wave path remains 30 CSS px high with its existing stroke and `vector-effect="non-scaling-stroke"`. The full semantic Fraction and anchor metadata remain unchanged. Waves remain within their cell/card; arrows stay in front of waves, and PM remains in front of both.

## 2. Concrete Tests

1. Measure stroke-inclusive SVG wave bounds against all visible real attack bounds in the live compact banks. Require at least 3.0 CSS px at 400px and 600px for grid8/grid16, and positive clearance with no contact at 320/421/480/840/1100/1600px. Exclude only the explicit synthetic packing clone from this oracle.
2. Preserve all required wave Fractions/counts and accessible names; verify the common path, at least 7px painted height, natural arrow size, cell/card bounds, and at least 0.25px between neighboring grid16 waves at 320/400/421/600px.
3. Capture and visually inspect the 16-image JA/EN × Light/Dark × 400/600px grid8/grid16 matrix from current source. Sidecars record painted clearances, dimensions, card/next-chord bounds, and PNG SHA-256.
4. Preserve v18's exact 6px technique-to-chord-name gutter and all other approved requirements. Run configured repository gates and report failures exactly.

## 3. Document Impact

| Owner | Files | Change |
|---|---|---|
| Specification | `docs/specs/gui_design.md`, `docs/specs/extension.md` | Replace v19's provisional formula with the verified clearance formula. |
| Design | `docs/design/preview-rendering-and-export.md` | Record the corrected visual placement independently from musical anchors. |
| Help | EN/JA feature help, `help-manifest.json`, generated `media/help/` | Review Practice Guide wording and refresh the reviewed digest. |
| Status / evidence | `docs/status/implementation-status.md`, `docs/status/evidence/issue-162/README.md`, v20 delta | Record current implementation, screenshots, and verification. |

## 4. Verification

Run `npm run compile:all`, `npm run test:unit`, `npm test`, `npm run check:help`, `npm run check:ai`, `npm run vscode:prepublish`, `python3 -m agent_workflow verify-implementation-contract 162`, `python3 -m agent_workflow validate-docs --issue 162`, `git diff --check`, required PR CI, current-HEAD self-review, and the repository delivery check. Run VS Code/Electron and GitHub operations outside the command sandbox. Report exact results, including unrelated full-suite failures.

## 5. Reviewer Checklist

- [ ] Stroke-inclusive wave and arrow bounds are at least 3px apart at 400/600px and do not touch at other required widths.
- [ ] Waves retain their original timing, Fraction, node count, shape, height, stroke, and accessible identity.
- [ ] Wave width remains within its cell/card, and neighboring grid16 waves retain at least 0.25px painted clearance.
- [ ] Arrows remain uncompressed and in front; PM remains in front of both.
- [ ] The 16 current-source screenshots and sidecars show visible separation and preserve the v18 6px lane gutter.
- [ ] Every other approved requirement and repository delivery gate is current-HEAD verified.
