#!/usr/bin/env bash
set -euo pipefail

# The legacy creator duplicated the /webhook/aiso-scan registration.
cat >&2 <<'TEXT'
Automatic workflow creation is retired.
Prepare a local update for the verified existing workflow instead:
  node n8n/prepare-scan-workflow.mjs \
    --workflow-id <existing-id> \
    --openrouter-credential-id <existing-header-credential-id> \
    --output <reviewable-plan.json>

This creates a local review file only. See n8n/README.md for the
workflow-first rollout and execution-receipt verification procedure.
TEXT
exit 2
