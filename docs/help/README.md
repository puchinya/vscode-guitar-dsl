# Help authoring (`docs/help/`)

This directory holds the **authored source** of the built-in GuitarDSL Help. The extension opens it with `guitardsl.openHelp` and the preview toolbar's **?** button. Help is user-facing documentation **derived from** the normative specs. `docs/specs/` stays authoritative: if Help and a spec disagree, fix Help.

| Path | Role |
|---|---|
| `help-manifest.json` | Source spec paths, page order, which spec section each page explains (`coverage`) and deliberate exclusions (`excludedSections`) |
| `ja/*.md`, `en/*.md` | Hand-written pages (`about`, `features`, `language`, `troubleshooting`); both locales are required |
| `../../media/help/guitardsl-help.{ja,en}.md` | **Generated, packaged output. Never edit by hand.** |

The command and settings references at the end of each generated file come from `package.json` + `package.nls*.json`. Do not write command or setting lists by hand.

## Commands

```bash
npm run generate:help                            # rewrite media/help/*.md (also runs automatically before npm run compile)
npm run check:help                               # read-only sync gate (runs first in npm test)
node scripts/check-help-sync.mjs --print-digests # print the current digest of every spec section
```

`check:help` fails and names the section, key or file that needs action when:

- a top-level numbered `##` section of `docs/specs/guitardsl-syntax.md` or `docs/specs/extension.md` is neither covered nor excluded;
- a mapping is stale, duplicated or points at an unknown source or page;
- an exclusion has an empty reason;
- a covered section's text changed since review;
- `package.json` commands or settings differ from the extension spec §3 / §3.7;
- an NLS key is missing in English or Japanese;
- the committed `media/help` files differ from a fresh generation.

## Topic markers (`help-sources`)

Each heading in an authored page is followed on the **next line** by a marker naming the spec sections that the heading's prose explains:

```markdown
### Note Groups (Simultaneous Notes)
<!-- help-sources: syntax:18 -->
```

`check:help` enforces these rules:

- **Every heading needs a marker.** Headings inside code fences are exempt.
- **Refs must be covered.** Every ref must point to a section with a `coverage` entry. Refs to removed, renumbered or excluded sections fail as obsolete prose.
- **Every covered section must be claimed.** At least one heading on its `helpPage` must name it, in both `ja/` and `en/`.
- **Locales must match.** `ja/` and `en/` must claim the same set of sections for each page.

The rules make a removal complete. Deleting a spec section and its `coverage` entry is not enough: every heading that still names the section fails until its prose is removed or rewritten. Deleting only the marker also fails, because the heading then has none. Markers are stripped from the generated `media/help` files.

## `reviewedSourceSha256`

Each `coverage` entry records the SHA-256 of the section text that the Help page was reviewed against. Before hashing, the text is normalized: LF line endings, trailing spaces removed, and leading/trailing blank lines and `---` rules removed. When the section changes, `check:help` fails and prints the new digest.

Updating the digest is a **review action**:

1. Read the changed spec section.
2. Update both `ja/` and `en/` pages if users need to know about the change.
3. Only then paste the new digest into the manifest.

Even when the wording stays correct, the refresh records that someone checked it.

## Feature add / change / remove

1. **Spec first.** Update `docs/specs/` (and `package.json` for commands or settings).
2. **New section.** Add a `coverage` entry for the page that explains it, or an `excludedSections` entry with a reason when users need no Help prose for it.
3. **Changed section.** Review and update the pages, then refresh the digest.
4. **Removed section or feature.** Delete the stale mapping. `check:help` then points at every heading whose `help-sources` still names the section; remove or rewrite that prose.
5. **Regenerate and verify.** Run `npm run generate:help`, then `npm run check:help`, and commit the regenerated `media/help` files.

Keep Help aligned with features implemented in the current release, including the Preview's score playback controls. Keep `guitardsl` examples valid (a unit test parses them) and do not copy whole spec sections.
