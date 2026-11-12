# Issue #162 reference source provenance (Contract v28)

This note narrows the claims supported by the stroke-pattern reference artifacts after PR #163 review `5857496358`.

| Artifact | Provenance and supported use | Claims it does not support |
|---|---|---|
| [`user-reference-stroke-pattern-crop.png`](user-reference-stroke-pattern-crop.png) | Partial crop from a user-supplied screenshot; visual context for the requested stroke style. | A complete screenshot, a verified 8/16-beat event transcription, exact event/Fraction positions, or an independently documented measure mapping. |
| [`stroke-reference-trace-8beat-v24.svg`](stroke-reference-trace-8beat-v24.svg) | Reference-derived 8-beat vector geometry specimen; it provides the 15×47 arrow/wave path masters and a layout example. | A verified segment-by-segment match to the saved crop. The PR review identified a first-group pattern mismatch. |
| [`stroke-reference-trace-16beat-v24.svg`](stroke-reference-trace-16beat-v24.svg) | Reference-derived 16-beat vector geometry specimen; it provides a layout example using the same path masters. | A verified transcription of the corrected 16-beat source. The corrected original screenshot is not present in this checkout or the reviewed evidence set. |
| [`issue162-stroke-reference-v24-comparison.png`](issue162-stroke-reference-v24-comparison.png) | A side-by-side visual juxtaposition of the crop and vector specimens at native scale. | Source-to-trace equivalence, event sequence, exact spacing, or pixel accuracy. Treat it as illustrative only. |

## Review observation and verification state

The review observed the first source group as `D, wave, D, U, D, U, D, U` and the corresponding 8-beat vector group as `D, wave, D, U, wave, U, D, U`. This is enough to reject the earlier exact-trace claim; this note does not reconstruct or infer the complete source score from the partial crop.

Exact source-to-trace sequence, spacing, and pixel comparison: **NOT RUN**. The full corrected 8-beat and 16-beat source screenshots plus their segment mapping are needed to make that comparison. The v28 `reference-r6` runtime screenshots and DOM sidecars support compact rendering claims only: reference-scale calculation, Fraction anchors, SVG geometry, spacing/clearance, four-card layout, complete chord diagrams, and next-chord visibility. They do not establish exact reproduction of the source images.

Contract v28 is canonical at [Issue #162 comment 6794304855](https://github.com/puchinya/vscode-guitar-dsl/issues/162#issuecomment-6794304855), SHA-256 `e95e741c0d9fad7d52071ec6b3257c71dbb8be23a32507912d51cd6670b50d66`. It supersedes v27 and the broader trace-equivalence wording in v26 for this evidence scope.
