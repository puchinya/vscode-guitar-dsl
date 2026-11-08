# Implementation Contract v18 Delta — 奏法とコード名の縦余白

- Repository: `puchinya/vscode-guitar-dsl`
- Issue: [#162](https://github.com/puchinya/vscode-guitar-dsl/issues/162)
- PR: [#163](https://github.com/puchinya/vscode-guitar-dsl/pull/163)
- Canonical v17: Issue #162 comment [`6710548502`](https://github.com/puchinya/vscode-guitar-dsl/issues/162#issuecomment-6710548502), 4,544 bytes, SHA-256 `451de65187bddc67a21e8514b6930b615b76e0e8d197b086b1f5fdeac366521c`.
- This delta adds a compact-only vertical gutter between the technique lane and chord-name lane. Every other v17 and earlier requirement remains authoritative.

> This document is an Implementation Contract. Do not redesign the architecture during implementation. If a requirement conflicts with repository reality or requires a material design change, report the exact conflict and continue only with independent valid work.

## 1. Decision

When both the compact technique lane and chord-name lane are visible, reserve a **6 CSS px vertical gap** after the technique lane and before the chord-name lane. The measured chord-name text ink must begin at least 6 CSS px below the technique-lane bottom in both template and live banks. Keep this spacing stable when melody/lyrics visibility, selected grid, page, or playback bank changes.

The extra space increases the compact card height by 6 CSS px and shifts the chord-name and diagram lanes down by 6 CSS px. Keep the existing technique-lane height, chord-name font-size/fitting, diagram square size, and full diagram bounds unchanged. The full chord diagrams must remain visible inside their SVG/card bounds.

This delta does not affect detailed timeline spacing, attack/wave horizontal separation, score timing, card count, next-chord layout, melody geometry, lyric sizing, or bank fade behavior.

## 2. Concrete Tests

1. At 400px and 600px, inspect all four compact measures in both template and live banks. Measure the technique-lane bottom and chord-name text bounds; assert at least 6 CSS px between them.
2. Repeat with grid8/grid16, melody on/off, lyric lane present/absent, one-to-four chord measures, and page/bank changes. The gutter must remain exactly 6px where both lanes exist.
3. Assert chord-name text and complete diagrams remain within their respective SVG lanes/cards; the diagram square size and finger-dot counts are unchanged.
4. Capture and visually inspect the v18 JA/EN × Light/Dark × 400/600px grid8/grid16 screenshot matrix, with DOM sidecars and PNG dimensions/SHA-256.
5. Preserve and rerun all non-spacing v17 acceptance tests and the full repository verification gate. Report failures honestly.

## 3. Document Impact

| Owner | Files | Change |
|---|---|---|
| Specification | `docs/specs/gui_design.md`, `docs/specs/extension.md` | Specify a stable 6px compact vertical gap from the technique lane to the chord-name lane. |
| Design | `docs/design/preview-rendering-and-export.md` | Document the 6px compact gutter and preserve full chord diagrams. |
| Status / evidence | `docs/status/implementation-status.md`, `docs/status/evidence/issue-162/README.md`, v18 delta | Record the updated rendering, DOM checks, screenshots, and verification. |

## 4. Verification

Run `npm run compile:all`, `npm run test:unit`, `npm test`, `npm run check:help`, `npm run check:ai`, `npm run vscode:prepublish`, `python3 -m agent_workflow verify-implementation-contract 162`, `python3 -m agent_workflow validate-docs --issue 162`, `git diff --check`, required PR CI, current-HEAD self-review, and the repository delivery check. Run commands that launch VS Code/Electron and GitHub operations outside the command sandbox. Report the exact result for each gate; do not call an unrun or failed gate PASS.

## 5. Reviewer Checklist

- [ ] The compact technique lane and chord-name lane have a stable 6 CSS px vertical gutter in template and live banks.
- [ ] Melody, lyric, grid, page, and bank changes do not collapse the gutter.
- [ ] Chord labels remain legible and complete diagrams remain inside their lanes/cards.
- [ ] The v17 no-touch wave/arrow behavior and 400/600px clearance thresholds remain unchanged.
- [ ] All 16 v18 screenshots and DOM sidecars are current-source, dimension-checked, SHA-linked, and visually inspected.
- [ ] Every other v17 requirement and repository delivery gate is current-HEAD verified.
