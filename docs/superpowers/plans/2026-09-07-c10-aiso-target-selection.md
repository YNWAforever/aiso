# C10 AISO target selection

Date: 2026-09-07. User decision: use AISO, not legacy production.

## Selected identities and fresh read-only evidence

- Cloudflare account: e387dfbeded3deb5b8f0023a78a660b5; Worker: aiso-cron-worker.
- Vercel team: team_qvzlsFmfCsLkgItSypqHjw3z.
- Selected project: prj_f9sxRkT1gxcBSYgT7ELIwHWqUDDV (aiso).
- Stable origin: https://aiso-kappa.vercel.app.
- Resolving this alias through get_deployment returned dpl_3NeDiY6mEEVp4iYcUiwDGz5ygKHE, project aiso, READY, target production.
- Source: YNWAforever/aiso, main, SHA 10d9a17cd6292a0534edf4fd532760a8de9ea454 (PR #14 merge).
- The project's latestDeployment field separately points to dpl_pGejLtrozYBNvt5eVUqKRXyx8JAp, READY, target null. Latest deployment must not be mistaken for the production alias target.

The selected production deployment does not establish deployment of the completed C9 implementation. No authenticated endpoint was invoked. These API reads verify alias/deployment association, not application health, database bindings, secret presence or scheduler ownership.

## Local configuration change

Added only APP_BASE_URL=https://aiso-kappa.vercel.app to cloudflare/aiso-worker/wrangler.jsonc. Schedules remain empty and workers.dev/preview access disabled. No secret added. The existing deployed Worker was not changed: its last verified state still has no bindings. Local config and live state therefore intentionally differ by the proposed origin binding.

This target decision supersedes the legacy-origin candidate in the earlier live discovery document. It does not authorize production deployment, secrets transfer, cron activation, provider calls or data writes.

## Remaining preparation before activation approval

1. Reconcile an exact tested AISO release with the selected production deployment; prepare any required deployment as a separately reviewable action.
2. Verify the selected production environment's database/role and migration ledger, provider modes, and CRON_SECRET source through scoped metadata/approved secret handling.
3. Establish one live producer per job across Cloudflare, Vercel and n8n; those facts remain unverified.
4. Complete isolated validation without real email or paid scans, then prepare the per-job schedule diff and rollback using the updated runbook.

No additional product-target choice is needed. Remaining items require evidence and, for mutations, the exact action package.

## Validation and rollback

Local config assertions verified exact account/name/origin, empty schedules and disabled public/preview access. The six existing Worker tests passed. git diff --check passed. No live health, SQL, email, paid scan or full application test was run for this configuration-only change.

Local rollback removes only the APP_BASE_URL vars entry. No external rollback is needed because this turn made no external mutation. Eventual activation rollback must disable schedules and reconcile in-flight work before restoring any previous producer; refer to docs/runbooks/deploy-cron-worker.md.
