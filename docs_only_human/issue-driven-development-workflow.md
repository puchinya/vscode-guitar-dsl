# vscode-guitar-dsl development overview

This is a short human-oriented route into the repository's project rules. The shared Issue workflow is owned by the installed `ai-agent-workflow` plugin; this document intentionally does not reproduce its requirements, design, implementation, review, or delivery procedures.

The plugin package and Python runtime are installed per user. The repository files only activate that installed plugin in Codex and Claude Code for this checkout.

## Repository-specific sources

- [`AGENTS.md`](../AGENTS.md) defines project policy, document authority, synchronization rules, and project helper routing.
- [`docs/README.md`](../docs/README.md) routes to the public specifications, architecture, current status, technical guides, and Help documentation.
- [`docs/agents/extension.md`](../docs/agents/extension.md) covers extension architecture.
- [`docs/agents/testing.md`](../docs/agents/testing.md) defines verification commands.

## Project helpers

- `scripts/project/ensure-version-milestone.sh <issue>` assigns the milestone matching the package version. Use the `.ps1` counterpart in PowerShell.
- `scripts/project/start-feature-branch.sh <issue> <description>` creates or switches to a source branch and removes stale `out/` artifacts on an actual switch. Use the `.ps1` counterpart in PowerShell.

## Verification

For extension changes, run the mandatory compile and test gate in `docs/agents/testing.md`. Use the same guide for packaging, Help/AI synchronization, and platform-specific requirements. Report unrun checks separately from passing checks.
