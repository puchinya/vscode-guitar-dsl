# Implementation Contract v17 Delta — 画面幅別の矢印間隔検証

- Repository: `puchinya/vscode-guitar-dsl`
- Issue: [#162](https://github.com/puchinya/vscode-guitar-dsl/issues/162)
- PR: [#163](https://github.com/puchinya/vscode-guitar-dsl/pull/163)
- Canonical v16: Issue #162 comment [`6710392128`](https://github.com/puchinya/vscode-guitar-dsl/issues/162#issuecomment-6710392128), 6,530 bytes, SHA-256 `e3bafc47ed53d3874be14970a900206154cf3436441db4c1548e1a649e8ee7d6`.
- This delta supersedes only v16's minimum-clearance threshold outside the required screenshot widths. Preserve v16's `anchorX-0.10*cell` origin, no-touch requirement, and at least 1.0 CSS px clearance at 400px and 600px for both grid8 and grid16. Every other requirement remains authoritative.

> This document is an Implementation Contract. Do not redesign the architecture during implementation. If a requirement conflicts with repository reality or requires a material design change, report the exact conflict and continue only with independent valid work.

## 1. Decision

Keep the v16 visual origin `anchorX-0.10*cell`, display width `max(2.8,cell-0.9)`, common wide SVG path, stroke, semantic anchor, and card clamp.

At 400px and 600px Preview widths, require a minimum 1.0 CSS px horizontal clearance between every painted continuation wave (including stroke) and every real visible attack bound in grid8 and grid16. At other tested widths 320/421/480/840/1100/1600px, require positive clearance greater than 0.01px and zero contact/crossing. Keep at least 0.25px painted clearance between adjacent grid16 waves at 320/400/421/600px.

The focused geometry test adds a synthetic same-onset attack only to verify simultaneous-event packing. Exclude that explicitly test-only clone from the wave/attack clearance oracle; continue to measure all real fixture attacks and separately assert that the clone preserves its accessible identity and distinct same-onset position. Screenshot E2Es contain no synthetic clone and measure every real attack.

## 2. Concrete Tests

1. Across the regular width sweep, measure `getBBox()` transformed through `getScreenCTM()` with the SVG stroke included, against visible real attack `getBoundingClientRect()` bounds. Assert no wave/attack contact at every width and at least 1.0px at widths 400px and above.
2. Retain all v16 path counts/Fractions, master shape, painter order, wave-wave gaps, accessibility, natural arrow size, page capacity, and grid-switch/resize checks.
3. Capture and visually inspect the 16-image JA/EN × Light/Dark × 400/600px grid8/grid16 matrix from current source. Record minimum wave/attack clearance, PNG dimensions, hashes, card and next-chord bounds in JSON sidecars.
4. Preserve and rerun all non-wave v16 acceptance tests and the full repository verification gate. Report failures honestly.

## 3. Document Impact

| Owner | Files | Change |
|---|---|---|
| Specification | `docs/specs/gui_design.md`, `docs/specs/extension.md` | Keep coefficient `0.10`; specify ≥1px at 400/600px and strictly positive clearance elsewhere. |
| Design | `docs/design/preview-rendering-and-export.md` | Document width-scoped clearance thresholds and separate the synthetic packing fixture from real-attack geometry. |
| Status / evidence | `docs/status/implementation-status.md`, `docs/status/evidence/issue-162/README.md`, v17 delta | Record current-HEAD code, measurements, screenshots, and verification. |

## 4. Verification

Run `npm run compile:all`, `npm run test:unit`, `npm test`, `npm run check:help`, `npm run check:ai`, `npm run vscode:prepublish`, `python3 -m agent_workflow verify-implementation-contract 162`, `python3 -m agent_workflow validate-docs --issue 162`, `git diff --check`, required PR CI, current-HEAD self-review, and the repository delivery check. Run commands that launch VS Code/Electron and GitHub operations outside the command sandbox. Report the exact result for each gate; do not call an unrun or failed gate PASS.

## 5. Reviewer Checklist

- [ ] v16's 0.10 wave-origin coefficient, no-touch behavior, and 400/600px ≥1px requirement are unchanged.
- [ ] Real wave and attack bounds do not touch at every tested width.
- [ ] The test-only simultaneous clone is excluded only from the clearance oracle and remains covered by its dedicated packing assertions.
- [ ] The 16 current-HEAD screenshots and JSON sidecars are dimension-checked, SHA-linked, and visually inspected.
- [ ] Every other v16 requirement and repository delivery gate is current-HEAD verified.
