# vscode-guitar-dsl project policy

The installed `ai-agent-workflow` plugin is the sole authority for the common requirements, design, implementation, checkpoint, evidence, self-review, and delivery workflow. This repository keeps only project-specific policy and technical guidance. Do not recreate common workflow procedures here.

The plugin package and its Python runtime are installed per user. This checkout only enables the already-installed plugin through `.codex/config.toml` and `.claude/settings.json`.

## Document authority

| Source | Authority |
|---|---|
| `docs/specs/` | Public GuitarDSL syntax and extension behavior |
| `docs/design/` | Durable internal architecture |
| `package.json`, `language-configuration.json`, `syntaxes/` | Extension contributions and grammar |
| `src/` | TypeScript implementation |
| `docs/status/` | Current implementation and verification status |
| `docs/agents/` | Project technical rules |

Start document lookup at [`docs/README.md`](docs/README.md), then the relevant category README and only the needed sections. Do not change a spec to match a bug. If implementation exposes a missing or contradictory public contract or material architecture decision, return to the Issue requirements/design workflow before deciding it in code.

## Help and AI asset synchronization

User Help in `docs/help/` and `media/help/` is derived from `docs/specs/` and `package.json`, not an authority. For a user-facing feature, command, setting, or GuitarDSL syntax change, review Help and refresh the reviewed source digest in `docs/help/help-manifest.json`, even when wording stays the same. Use `npm run check:help` as the gate.

AI reference assets are generated from the canonical syntax spec. Use `npm run check:ai` as the gate; do not hand-edit generated copies.

## Project helpers

- Assign the package-version milestone with `scripts/project/ensure-version-milestone.sh <issue>` or `.ps1` on PowerShell.
- Create or switch a source branch with `scripts/project/start-feature-branch.sh <issue> <description>` or `.ps1` on PowerShell. Its output is the branch naming authority. An actual branch switch removes stale `out/` compilation artifacts; do not clean them when already on the requested branch.

## Verification and repository operations

[`docs/agents/testing.md`](docs/agents/testing.md) is the verification command authority. For extension changes, the mandatory gate is `npm run compile` and `npm test`; packaging changes also require `npm run vscode:prepublish` and `npx @vscode/vsce ls` as specified there. Record checks that were not run accurately.

Use `gh` for GitHub Issues, PRs, labels, comments, reviews, and Actions; use `git` for local branch, staging, commit, and push operations. For multiline GitHub Markdown, use `--body-file` with real newline characters. For visual rendering changes, generate and verify a rendered preview and attach the image evidence to the owning Issue.

## Technical guides and communication

- Read [`docs/agents/extension.md`](docs/agents/extension.md) for extension architecture.
- Read [`docs/agents/testing.md`](docs/agents/testing.md) for tests and verification.
- Ask user questions in Japanese.
