# CLAUDE.md

Claude Code must follow the repository-wide rules in [`AGENTS.md`](AGENTS.md). This file is only the Claude Code entry point and does not redefine shared workflow, document authority, or product behavior.

## Communication

Ask all user questions in Japanese.

## Claude Code routing

1. Before entering Plan Mode, creating a plan or task list, or performing broad repository investigation, follow the Mandatory Task Bootstrap in [`AGENTS.md`](AGENTS.md). For a new repository-changing request with no associated Issue, this enters `phase:requirements` before normal planning.
2. For repository-changing work, after the bootstrap is complete, read the active Issue phase label and only the corresponding workflow document listed in [`AGENTS.md`](AGENTS.md).
3. Do not run ad-hoc verification commands when a phase or guide specifies an authoritative helper or gate.
