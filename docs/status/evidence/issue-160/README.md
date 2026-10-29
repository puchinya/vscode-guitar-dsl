# Issue #160 visual evidence

## Current Implementation Contract v2-C evidence

These Preview screenshots and PDFs use the same exact DSL fixtures and four-measure titles. The Extension Development Host was VS Code 1.144.0. Preview captures use a 500 CSS-pixel webview viewport and retain the real Preview controls and score; 1x and 2x use the same layout at native and double output-pixel scales. Themes are `Light 2026` and `Dark 2026`.

| Role sample | Page Preview | Continuous Preview |
|---|---|---|
| Vocal + rhythm | [Light 1x](v2-c-preview-captures/vocal-rhythm-page-light-1x.png), [Light 2x](v2-c-preview-captures/vocal-rhythm-page-light-2x.png), [Dark 1x](v2-c-preview-captures/vocal-rhythm-page-dark-1x.png), [Dark 2x](v2-c-preview-captures/vocal-rhythm-page-dark-2x.png) | [Light 1x](v2-c-preview-captures/vocal-rhythm-web-light-1x.png), [Light 2x](v2-c-preview-captures/vocal-rhythm-web-light-2x.png), [Dark 1x](v2-c-preview-captures/vocal-rhythm-web-dark-1x.png), [Dark 2x](v2-c-preview-captures/vocal-rhythm-web-dark-2x.png) |
| TAB + shown rhythm | [Light 1x](v2-c-preview-captures/guitar-brace-page-light-1x.png), [Light 2x](v2-c-preview-captures/guitar-brace-page-light-2x.png), [Dark 1x](v2-c-preview-captures/guitar-brace-page-dark-1x.png), [Dark 2x](v2-c-preview-captures/guitar-brace-page-dark-2x.png) | [Light 1x](v2-c-preview-captures/guitar-brace-web-light-1x.png), [Light 2x](v2-c-preview-captures/guitar-brace-web-light-2x.png), [Dark 1x](v2-c-preview-captures/guitar-brace-web-dark-1x.png), [Dark 2x](v2-c-preview-captures/guitar-brace-web-dark-2x.png) |
| Vocal + TAB + rhythm | [Light 1x](v2-c-preview-captures/nested-page-light-1x.png), [Light 2x](v2-c-preview-captures/nested-page-light-2x.png), [Dark 1x](v2-c-preview-captures/nested-page-dark-1x.png), [Dark 2x](v2-c-preview-captures/nested-page-dark-2x.png) | [Light 1x](v2-c-preview-captures/nested-web-light-1x.png), [Light 2x](v2-c-preview-captures/nested-web-light-2x.png), [Dark 1x](v2-c-preview-captures/nested-web-dark-1x.png), [Dark 2x](v2-c-preview-captures/nested-web-dark-2x.png) |

The exact source files used for both Preview and PDF are [vocal + rhythm](v2-c-samples/vocal-rhythm.guitardsl), [TAB + rhythm](v2-c-samples/guitar-brace.guitardsl), and [nested vocal + TAB + rhythm](v2-c-samples/nested.guitardsl). The Preview E2E verified explicit rhythm in every measure and checked the visible score DOM: vocal + rhythm has 10 standard staff lines, one outer bracket and no TAB strings; TAB + rhythm has five standard staff lines, six TAB strings and one guitar brace; nested has 10 standard staff lines, six TAB strings, one outer bracket and one guitar brace. Each sample also has one left group connector and the required visible inter-staff gap connectors. The capture run passed all assertions (1 passing).

PDFs were generated from those same source files through the compiled product `renderScorePdf` path by [generate-v2-c-pdfs.cjs](generate-v2-c-pdfs.cjs), then rasterized with `pdftoppm`.

| Role sample | PDF and raster evidence |
|---|---|
| Vocal + rhythm, A4 | [PDF](v2-c-pdf/vocal-rhythm-a4.pdf), [72 dpi](v2-c-pdf/vocal-rhythm-a4-72dpi.png), [144 dpi](v2-c-pdf/vocal-rhythm-a4-144dpi.png) |
| TAB + shown rhythm, A4 | [PDF](v2-c-pdf/guitar-brace-a4.pdf), [72 dpi](v2-c-pdf/guitar-brace-a4-72dpi.png), [144 dpi](v2-c-pdf/guitar-brace-a4-144dpi.png) |
| Vocal + TAB + rhythm, A4 | [PDF](v2-c-pdf/nested-a4.pdf), [72 dpi](v2-c-pdf/nested-a4-72dpi.png), [144 dpi](v2-c-pdf/nested-a4-144dpi.png) |
| Vocal + TAB + rhythm, narrow A5 | [PDF](v2-c-pdf/nested-a5.pdf), [72 dpi](v2-c-pdf/nested-a5-72dpi.png), [144 dpi](v2-c-pdf/nested-a5-144dpi.png) |

All four PDFs contain one page. `pdfinfo` reports A4 for the first three and A5 for the narrow nested sample. Raster dimensions are 596×842 and 1191×1684 pixels for A4 at 72/144 dpi, and 420×596 and 840×1191 pixels for A5. The 72/144 dpi renderings were visually checked for left-margin clipping and connector placement.

## Historical evidence

The images below predate v2-B and remain for comparison only; their old bracket outline is not acceptance evidence for the current contract.

These historical images covered the v2 role matrix. The files named `single` and `web` are screenshots from the VS Code Extension Development Host Preview: `single` is page mode and `web` is continuous mode. Light and dark files were captured with the matching VS Code themes. `1x` and `2x` are native and double-output-scale captures of the same Preview viewport.

### Historical VS Code Preview captures

Each previous case has page and continuous Preview screenshots in both themes at 1x and 2x:

- `vocal-rhythm-*`: vocal melody plus rhythm; one outer staff bracket and no guitar brace.
- `guitar-brace-*`: TAB plus explicitly shown rhythm, without a vocal staff; one guitar brace and no outer bracket.
- `nested-*`: vocal melody, TAB, and rhythm; one outer bracket and an inner brace over the two guitar staves.

For example, [nested page mode, dark theme, 1x](nested-single-dark-1x.png) and [nested continuous mode, light theme, 2x](nested-web-light-2x.png).

### Historical renderer output

The following files were generated before the v2-B shape change and are retained as historical references:

| Case | Continuous Preview SVG | Page Preview SVG | PDF page |
|---|---|---|---|
| Vocal + rhythm | [1x](brace-two-staff.png), [2x](brace-two-staff-200.png) | [1x](vocal-rhythm-page-1x.png), [2x](vocal-rhythm-page-2x.png) | [1x](vocal-rhythm-pdf-1x.png), [2x](vocal-rhythm-pdf-2x.png) |
| TAB + rhythm | [1x](guitar-brace-two-staff.png), [2x](guitar-brace-two-staff-200.png) | [1x](guitar-brace-page-1x.png), [2x](guitar-brace-page-2x.png) | [1x](guitar-brace-pdf-1x.png), [2x](guitar-brace-pdf-2x.png) |
| Vocal + TAB + rhythm | [1x](brace-three-staff.png), [2x](brace-three-staff-200.png) | [1x](nested-page-1x.png), [2x](nested-page-2x.png) | [1x](nested-pdf-1x.png), [2x](nested-pdf-2x.png) |

Historical nested narrow-page files: [A5 page SVG](nested-a5-page-1x.png) / [A5 PDF](nested-a5-pdf-1x.png), with [2x page SVG](nested-a5-page-2x.png) / [2x PDF](nested-a5-pdf-2x.png).

### Shape references

- [Guitar brace reference SVG raster](reference-brace.png) and [original Issue #160 image](brace-original-issue-reference.png) are preserved on the same canvas for shape comparison.
- [Standalone staff bracket reference](bracket-reference.png) and [nested bracket + brace reference](nested-reference.png) document the earlier v2 group roles.
- [Magnified brace detail](brace-detail.png) shows the filled contour. Unit geometry checks constrain the waist, tangent joins, and self-intersection.
