# Secure the optional n8n scan webhook

This procedure changes a deployed integration. The audit PR does not execute it.
Read finding A01 and the A08 summary-schema limitation in
[the audit](../audits/2026-10-25-full-audit.md) first.

The exported summary writer still expects `scans.ai_summary` and
`scans.updated_at`, which tracked migrations do not create. No app reader uses
`ai_summary`. Keep this optional integration off until its owner decides to
retire it or verifies the intended legacy storage contract. Do not add arbitrary
summary columns just to make a security test pass. The PGlite security test uses
the export-assumed schema and proves parameter safety, not schema equivalence.

1. Identify all deployed copies of `/webhook/aiso-scan`, their workflow IDs,
   installed n8n version, and stored Postgres role. Stop unauthenticated copies
   through the n8n control plane. Removing `N8N_SCAN_WEBHOOK_URL` from the app alone
   does not protect an already-public receiver.
2. Once storage is resolved, provision one dedicated random secret of at least
   32 characters. Store it as `N8N_SCAN_WEBHOOK_SECRET` in the app and in the
   provisioning environment. Do not put the value in a command, log or Git.
   Use a dedicated secret for each environment, distinct from cron, report,
   database, n8n management API and provider credentials.
3. Review `n8n/configure-credentials.sh` and select the intended existing
   `N8N_WORKFLOW_ID` and `N8N_POSTGRES_CREDENTIAL_ID`. Its historical defaults
   are explicit in the script and must be checked before use. The Postgres
   connection must be the least-privilege app role, not the migration owner.
   Verify its actual role and database binding separately; URL parsing cannot
   prove the connected role. Changing a shared Postgres credential can affect
   other workflows that use it.
4. Supply `N8N_API_KEY`, `DATABASE_URL`, `OPENROUTER_KEY`, and
   `N8N_SCAN_WEBHOOK_SECRET` through the environment, then run
   `bash n8n/configure-credentials.sh`. It validates the local authenticated
   export, confirms the remote workflow is inactive, provisions credentials,
   installs the local graph and activates only after successful responses.
   Any failure after deactivation leaves it stopped. An older unsupported n8n
   API can fail here; inspect the response/control plane before retrying.
5. If creating a workflow instead, `bash n8n/deploy-workflows.sh` requires the
   management API key and dedicated shared secret, creates it **inactive**, and
   returns an ID. Re-running creates a duplicate. Pass that ID to the
   configurator after selecting a valid Postgres credential. Do not activate
   the template manually before binding all credentials.
6. Verify in a sandbox first: missing and wrong authorization must return
   non-2xx and create no execution, database query or model request. Authorized
   synthetic scan IDs should affect exactly the intended scan/client pair.
   Verify SQL injection strings are rejected and quoted summary text remains
   data. Check actual summary persistence and the expected provider behavior.
   The export responds before later work completes, so HTTP 200 alone is not
   an acceptance result.
7. Configure the app's HTTPS webhook URL and matching secret together, then
   restart/redeploy through the normal release process and verify a permitted
   test scan end to end.
   Inspect authenticated workflow execution and database state; never infer
   success from the browser result or the immediate webhook response alone.

The app rejects non-HTTPS or malformed webhook URLs before scheduling dispatch,
so a configuration mistake cannot send the bearer credential over plain HTTP.
This also applies to local HTTP endpoints. Use an HTTPS sandbox for transport
acceptance; unit tests replace the transport with a synthetic boundary.

Credentials are passed to curl using private files, removed on script exit.
Do not run these scripts with shell tracing enabled. They suppress raw response
bodies so provider/API errors cannot echo secrets into terminal output.

Rollback: leave the workflow inactive and remove the optional app webhook URL.
The core scan path remains available. Do not restore the unauthenticated export
or downgrade to interpolated SQL. Restore enrichment only using a secured,
verified version and matching secret.

Independent remaining issue: dispatch HTTP failures have no durable retry
receipt (A07). This procedure does not introduce automatic retries or duplicate
paid calls.
