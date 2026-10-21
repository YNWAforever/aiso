# Scan summary execution receipts

The scan summary workflow uses the AISO API to claim one execution and save
its result. It does not connect to Postgres or set native Improve's
`agent_status`. Summary and receipt live under `scans.results._n8n`, so this
change requires no database migration.

## Local validation

`node n8n/build-scan-workflow.mjs` reproduces the checked-in JSON export.
The exported Code nodes are exercised through the actual callback route and
in-memory PostgreSQL in `__tests__/lib/n8n-receipts.test.ts`. All provider HTTP
nodes are replaced by fixtures. These are offline proofs, not live n8n receipts.

The application retains a frozen, bounded list of measured check findings,
its SHA-256, a dispatch ID and only a hash of a random per-scan capability.
Checks with failed, unsupported or unknown collection are excluded.
No sourced checks means no summary dispatch.

The workflow derives its callback origin from the operator-managed n8n variable
`AISO_APP_ORIGIN`, defaulting to `https://aiso-kappa.vercel.app`. A webhook caller
cannot supply a different callback URL. An invalid capability is refused before
any provider work. The start callback atomically binds the first n8n execution
and workflow IDs; a duplicate full delivery cannot acquire another provider claim.
The capability expires after 15 minutes for both start and completion callbacks.
After expiry only the authenticated owner can read the retained receipt; recovery
requires reconciliation and a separately authorized write, not a model retry.
The webhook destination must be public HTTPS; cross-origin or other redirects
are refused before forwarding the capability.

Acknowledgement is HTTP 202 after that claim. It means accepted, not completed.
Provider errors, empty output, failed writes and unknown outcomes cannot become
successful summary receipts. Provider retries are disabled. Do not manually retry
from a failed provider node: n8n can resume downstream of the claim gate. A paid
recovery requires a separately approved operation and reconciliation first.

The old Slack placeholder branch and obsolete DB lookup/update nodes are not in
this summary workflow. This receipt covers summary processing, not alert delivery.
The application's monitoring and alert schedules are unrelated and stay unchanged.

## Receipt read and independent verification

An authenticated scan owner can read:

```text
GET /api/scans/<scan-id>/n8n
```

The response includes dispatch state, execution/workflow IDs, source and summary
hashes, timestamps, safe provider usage and the saved summary. It excludes
capability material. Old scans without a receipt return `not_recorded`; they are
not silently labelled successful or disabled.

Callback-authenticated completion is identified by `callbackAuthenticated`.
The GET projection deliberately leaves `executionVerified=false`: a callback
cannot independently prove the final state of the n8n execution.

Save that owner GET response locally and, with separately provided read access,
check the exact execution:

```text
node n8n/verify-execution.mjs --receipt <owner-response.json> --output <proof.json>
```

This uses `N8N_API_KEY` to make one read-only `GET /api/v1/executions/<id>?includeData=true`.
`N8N_API_BASE_URL` defaults to `https://anfield-n8n.zeabur.app/api/v1/`.
It performs no execution, retry, workflow update or provider request.
It checks the execution's terminal status, workflow/scan/dispatch identity,
source hash and saved output. Only reduced proof fields are printed or saved;
raw execution data and credentials are never exported. Missing read credentials
stop before any request.

Keep successful and failed execution data enabled in n8n. The checked-in workflow
does so; deleting retained execution data prevents independent verification.

## Reviewable rollout, requiring separate authorization

1. Read the existing workflow and confirm its ID, active webhook registration,
   version and OpenRouter header credential. Do not use the MCP bearer token as
   an `X-N8N-API-KEY`. Do not recover old credentials from Git history.
2. Prepare an update for that existing workflow:

   ```text
   node n8n/prepare-scan-workflow.mjs --workflow-id <existing-id> --openrouter-credential-id <existing-header-credential-id> --output <plan.json>
   ```

   This is local preparation only. Review its `PUT` path and `body`. The legacy
   shell helpers stop rather than creating duplicates, changing DB credentials
   or activating workflows incidentally.
3. Once authorized, update the existing n8n workflow first, then deploy the
   matching application source. The new workflow rejects old unsigned payloads
   before provider work. During this short transition legacy requests do not
   produce summaries. Deploying the app first would send the new capability
   payload to an unverified legacy workflow; avoid that order.
4. With explicit approval for one bounded live scan, inspect both the owner GET
   receipt and the independently read execution proof. Verify reload persistence,
   one scan/summary and no monitoring. Do not replay historical scans automatically.

Roll back by disabling only this summary integration before changing protocol
versions. Retain stored receipts, summaries and source evidence. No destructive
schema rollback or monitoring activation is needed.
