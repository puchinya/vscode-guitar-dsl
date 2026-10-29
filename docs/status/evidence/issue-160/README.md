# Issue #160 visual evidence

These images cover the approved Implementation Contract v2 role matrix. The files named `single` and `web` are screenshots from the VS Code Extension Development Host Preview: `single` is page mode and `web` is continuous mode. Light and dark files were captured with the matching VS Code themes. `1x` and `2x` are native and double-output-scale captures of the same Preview viewport.

## VS Code Preview captures

Each case has page and continuous Preview screenshots in both themes at 1x and 2x:

- `vocal-rhythm-*`: vocal melody plus rhythm; one outer staff bracket and no guitar brace.
- `guitar-brace-*`: TAB plus explicitly shown rhythm, without a vocal staff; one guitar brace and no outer bracket.
- `nested-*`: vocal melody, TAB, and rhythm; one outer bracket and an inner brace over the two guitar staves.

For example, [nested page mode, dark theme, 1x](nested-single-dark-1x.png) and [nested continuous mode, light theme, 2x](nested-web-light-2x.png). The captures retain the surrounding Preview controls and score. The 2x files are captured at twice the output pixel scale; they do not change the Preview's CSS layout.

## Continuous, page, and PDF renderer output

The renderer outputs below are rasterized from the compiled SVG renderer at native and double pixel scale. The same roles are shown in each mode:

| Case | Continuous Preview SVG | Page Preview SVG | PDF page |
|---|---|---|---|
| Vocal + rhythm | [1x](brace-two-staff.png), [2x](brace-two-staff-200.png) | [1x](vocal-rhythm-page-1x.png), [2x](vocal-rhythm-page-2x.png) | [1x](vocal-rhythm-pdf-1x.png), [2x](vocal-rhythm-pdf-2x.png) |
| TAB + rhythm | [1x](guitar-brace-two-staff.png), [2x](guitar-brace-two-staff-200.png) | [1x](guitar-brace-page-1x.png), [2x](guitar-brace-page-2x.png) | [1x](guitar-brace-pdf-1x.png), [2x](guitar-brace-pdf-2x.png) |
| Vocal + TAB + rhythm | [1x](brace-three-staff.png), [2x](brace-three-staff-200.png) | [1x](nested-page-1x.png), [2x](nested-page-2x.png) | [1x](nested-pdf-1x.png), [2x](nested-pdf-2x.png) |

PDF uses the same black-on-white SVG output regardless of the VS Code theme. The nested group was also rendered to narrow A5 pages to check the left margin and clipping: [A5 page SVG](nested-a5-page-1x.png) / [A5 PDF](nested-a5-pdf-1x.png), with [2x page SVG](nested-a5-page-2x.png) / [2x PDF](nested-a5-pdf-2x.png).

## Shape references and close-up

- [Guitar brace reference SVG raster](reference-brace.png) and [original Issue #160 image](brace-original-issue-reference.png) are preserved on the same canvas for shape comparison.
- [Standalone staff bracket reference](bracket-reference.png) and [nested bracket + brace reference](nested-reference.png) document the v2 group roles.
- [Magnified brace detail](brace-detail.png) shows the filled contour. Unit geometry checks constrain the waist, tangent joins, and self-intersection.
