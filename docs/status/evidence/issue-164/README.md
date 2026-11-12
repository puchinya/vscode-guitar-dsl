# Issue #164 Practice Guide screenshots

These 44 PNGs were captured from the VS Code Extension Development Host on macOS arm64 after the Practice Guide became Compact-only. Each locale/theme run passed the focused Issue #164 E2E test.

| Locale | Theme | Layout captures | Grid captures |
|---|---|---|---|
| English | Dark | 400 / 421 / 600 / 1100 CSS px × melody on/off | 400 CSS px × grid 4 / 8 / 16 |
| English | Light | 400 / 421 / 600 / 1100 CSS px × melody on/off | 400 CSS px × grid 4 / 8 / 16 |
| Japanese | Dark | 400 / 421 / 600 / 1100 CSS px × melody on/off | 400 CSS px × grid 4 / 8 / 16 |
| Japanese | Light | 400 / 421 / 600 / 1100 CSS px × melody on/off | 400 CSS px × grid 4 / 8 / 16 |

The layout captures are exactly the requested CSS width and show four compact measure slots. The 1100px captures use a single editor group so the Preview fits inside the host workbench. Japanese runs used the installed Japanese language pack. The E2E verified that all four measure cards remain in bounds, the page has no horizontal overflow, melody and chord-diagram toggles render, and continuation marks follow each selected grid.

Representative captures: [English dark, 1100px, melody on](practice-guide-compact-issue164-en-dark-1100-melody-on.png), [Japanese light, 400px, grid 16](practice-guide-grid-issue164-ja-light-400-grid-16.png).
