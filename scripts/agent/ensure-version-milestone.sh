#!/usr/bin/env bash
set -euo pipefail

# Ensure that a GitHub Milestone exists for the root package.json version.
# When an Issue number is supplied, also assign that Issue to the Milestone.
#
# Usage:
#   scripts/agent/ensure-version-milestone.sh
#   scripts/agent/ensure-version-milestone.sh 123
#
# stdout contains only the resolved milestone title, making the command usable
# from another script. Informational messages are written to stderr.

ISSUE_NUMBER="${1:-}"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "error: required command not found: $1" >&2
    exit 1
  fi
}

require_command git
require_command gh
require_command python3

if [[ -n "$ISSUE_NUMBER" && ! "$ISSUE_NUMBER" =~ ^[0-9]+$ ]]; then
  echo "error: Issue number must be a positive integer: $ISSUE_NUMBER" >&2
  exit 1
fi

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$REPO_ROOT" ]]; then
  echo "error: run this script inside a Git repository" >&2
  exit 1
fi
cd "$REPO_ROOT"

if [[ ! -f package.json ]]; then
  echo "error: package.json was not found at the Git repository root" >&2
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "error: GitHub CLI is not authenticated. Run: gh auth login" >&2
  exit 1
fi

REPOSITORY="$(gh repo view --json nameWithOwner --jq '.nameWithOwner')"

VERSION="$(
  python3 - "$REPO_ROOT/package.json" <<'PY'
from __future__ import annotations
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
with open(path, "r", encoding="utf-8") as f:
    data = json.load(f)

version = data.get("version")
if not isinstance(version, str) or not version.strip():
    raise SystemExit("error: root package.json has no valid string 'version'")

if "\n" in version or "\r" in version:
    raise SystemExit("error: package.json version contains a newline")

print(version.strip())
PY
)"

MILESTONES_FILE="$(mktemp)"
trap 'rm -f "$MILESTONES_FILE"' EXIT

gh api \
  --paginate \
  --slurp \
  "repos/$REPOSITORY/milestones?state=all&per_page=100" \
  > "$MILESTONES_FILE"

MILESTONE_RESULT="$(
  python3 - "$MILESTONES_FILE" "$VERSION" <<'PY'
import json
import sys
from pathlib import Path

pages = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
title = sys.argv[2]

milestones = []
for page in pages:
    if isinstance(page, list):
        milestones.extend(page)

matches = [item for item in milestones if item.get("title") == title]

if len(matches) > 1:
    numbers = ", ".join(str(item.get("number")) for item in matches)
    raise SystemExit(
        f"error: duplicate GitHub Milestones named {title!r}: {numbers}"
    )

if not matches:
    print("missing")
else:
    item = matches[0]
    print(f"{item['number']}\t{item['state']}")
PY
)"

if [[ "$MILESTONE_RESULT" == "missing" ]]; then
  MILESTONE_NUMBER="$(
    gh api \
      --method POST \
      "repos/$REPOSITORY/milestones" \
      -f "title=$VERSION" \
      --jq '.number'
  )"
  echo "Created GitHub Milestone '$VERSION' (#$MILESTONE_NUMBER)." >&2
else
  IFS=$'\t' read -r MILESTONE_NUMBER MILESTONE_STATE <<< "$MILESTONE_RESULT"

  if [[ "$MILESTONE_STATE" != "open" ]]; then
    echo "error: GitHub Milestone '$VERSION' (#$MILESTONE_NUMBER) exists but is closed" >&2
    echo "       Do not create a duplicate. Reopen it or update package.json after deciding the intended release." >&2
    exit 1
  fi

  echo "Using GitHub Milestone '$VERSION' (#$MILESTONE_NUMBER)." >&2
fi

if [[ -n "$ISSUE_NUMBER" ]]; then
  gh issue edit \
    "$ISSUE_NUMBER" \
    --repo "$REPOSITORY" \
    --milestone "$VERSION" \
    >/dev/null
  echo "Assigned Issue #$ISSUE_NUMBER to Milestone '$VERSION'." >&2
fi

printf '%s\n' "$VERSION"
