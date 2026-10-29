# Issue #160 visual evidence

## Current Implementation Contract v2-B evidence

These files record the font-free SVG bracket implementation at PR #161 HEAD `37c74f42e958ec41f207d59635bc1a0e957ac605`, captured on 2026-10-30. The Extension Development Host was VS Code 1.144.0. Preview screenshots use a 500 CSS-pixel webview viewport and retain the real Preview controls and score. The 1x and 2x files capture the same layout at native and double output-pixel scales. Themes are `Light 2026` and `Dark 2026`.

| Role sample | Page Preview | Continuous Preview |
|---|---|---|
| Vocal + rhythm | [Light 1x](v2-b-head-37c74f4/vocal-rhythm-page-light-1x.png), [Light 2x](v2-b-head-37c74f4/vocal-rhythm-page-light-2x.png), [Dark 1x](v2-b-head-37c74f4/vocal-rhythm-page-dark-1x.png), [Dark 2x](v2-b-head-37c74f4/vocal-rhythm-page-dark-2x.png) | [Light 1x](v2-b-head-37c74f4/vocal-rhythm-web-light-1x.png), [Light 2x](v2-b-head-37c74f4/vocal-rhythm-web-light-2x.png), [Dark 1x](v2-b-head-37c74f4/vocal-rhythm-web-dark-1x.png), [Dark 2x](v2-b-head-37c74f4/vocal-rhythm-web-dark-2x.png) |
| TAB + shown rhythm | [Light 1x](v2-b-head-37c74f4/guitar-brace-page-light-1x.png), [Light 2x](v2-b-head-37c74f4/guitar-brace-page-light-2x.png), [Dark 1x](v2-b-head-37c74f4/guitar-brace-page-dark-1x.png), [Dark 2x](v2-b-head-37c74f4/guitar-brace-page-dark-2x.png) | [Light 1x](v2-b-head-37c74f4/guitar-brace-web-light-1x.png), [Light 2x](v2-b-head-37c74f4/guitar-brace-web-light-2x.png), [Dark 1x](v2-b-head-37c74f4/guitar-brace-web-dark-1x.png), [Dark 2x](v2-b-head-37c74f4/guitar-brace-web-dark-2x.png) |
| Vocal + TAB + rhythm | [Light 1x](v2-b-head-37c74f4/nested-page-light-1x.png), [Light 2x](v2-b-head-37c74f4/nested-page-light-2x.png), [Dark 1x](v2-b-head-37c74f4/nested-page-dark-1x.png), [Dark 2x](v2-b-head-37c74f4/nested-page-dark-2x.png) | [Light 1x](v2-b-head-37c74f4/nested-web-light-1x.png), [Light 2x](v2-b-head-37c74f4/nested-web-light-2x.png), [Dark 1x](v2-b-head-37c74f4/nested-web-dark-1x.png), [Dark 2x](v2-b-head-37c74f4/nested-web-dark-2x.png) |

The exact source files used for the three Preview captures are [vocal + rhythm](v2-b-head-37c74f4/samples/vocal-rhythm.guitardsl), [TAB + rhythm](v2-b-head-37c74f4/samples/guitar-brace.guitardsl), and [nested vocal + TAB + rhythm](v2-b-head-37c74f4/samples/nested.guitardsl). The PDF evidence below is generated through the compiled product `renderScorePdf` path by `.agent-state/issues/160/generate-review-renders.js`, then rasterized with `pdftoppm`.

| Role sample | PDF and raster evidence |
|---|---|
| Vocal + rhythm, A4 | [PDF](v2-b-head-37c74f4/pdf/vocal-rhythm-a4.pdf), [72 dpi](v2-b-head-37c74f4/pdf/vocal-rhythm-a4-72dpi.png), [144 dpi](v2-b-head-37c74f4/pdf/vocal-rhythm-a4-144dpi.png) |
| TAB + shown rhythm, A4 | [PDF](v2-b-head-37c74f4/pdf/guitar-brace-a4.pdf), [72 dpi](v2-b-head-37c74f4/pdf/guitar-brace-a4-72dpi.png), [144 dpi](v2-b-head-37c74f4/pdf/guitar-brace-a4-144dpi.png) |
| Vocal + TAB + rhythm, A4 | [PDF](v2-b-head-37c74f4/pdf/nested-a4.pdf), [72 dpi](v2-b-head-37c74f4/pdf/nested-a4-72dpi.png), [144 dpi](v2-b-head-37c74f4/pdf/nested-a4-144dpi.png) |
| Vocal + TAB + rhythm, narrow A5 | [PDF](v2-b-head-37c74f4/pdf/nested-a5.pdf), [72 dpi](v2-b-head-37c74f4/pdf/nested-a5-72dpi.png), [144 dpi](v2-b-head-37c74f4/pdf/nested-a5-144dpi.png) |

All four PDFs contain one page. `pdfinfo` reports A4 for the three A4 samples and A5 for the narrow nested sample. Raster dimensions are 596×842 and 1191×1684 pixels for A4 at 72/144 dpi, and 420×596 and 840×1191 pixels for A5. The 72/144 dpi renderings were visually checked for left-margin clipping and connector placement.

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
