#!/usr/bin/env bash
set -euo pipefail

# The scan summary workflow no longer connects directly to Postgres.
cat >&2 <<'TEXT'
The scan summary workflow uses the AISO receipt API for all reads and writes.
Do not copy DATABASE_URL or MIGRATE_DATABASE_URL into n8n.

Select an existing OpenRouter API HTTP Header Auth credential whose header is
Authorization: Bearer <provider-key>, then prepare the update with:
  node n8n/prepare-scan-workflow.mjs \
    --workflow-id <existing-id> \
    --openrouter-credential-id <existing-header-credential-id>

This helper does not change credentials or activate workflows.
See n8n/README.md before an authorized deployment.
TEXT
exit 2
