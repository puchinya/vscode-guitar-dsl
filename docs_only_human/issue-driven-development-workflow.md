# vscode-guitar-dsl development overview

This is a short human-oriented route into the repository's project rules. The shared Issue workflow is owned by the installed `ai-agent-workflow` plugin; this document intentionally does not reproduce its requirements, design, implementation, review, or delivery procedures.

The plugin package and Python runtime are installed per user. The repository files only activate that installed plugin in Codex and Claude Code for this checkout.

## Repository-specific sources

- [`AGENTS.md`](../AGENTS.md) defines project policy, document authority, synchronization rules, and lifecycle configuration.
- [`docs/README.md`](../docs/README.md) routes to the public specifications, architecture, current status, technical guides, and Help documentation.
- [`docs/agents/extension.md`](../docs/agents/extension.md) covers extension architecture.
- [`docs/agents/testing.md`](../docs/agents/testing.md) defines verification commands.

## Verification

Use `docs/agents/testing.md` for project testing guidance, Help/AI synchronization, and platform-specific verification requirements.
