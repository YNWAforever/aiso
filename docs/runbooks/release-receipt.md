# Release receipt

Read-only verification that the commit production is serving has the release
dependencies the project has always checked by hand. The tool is
`scripts/release/receipt.mjs`; it never deploys, never writes production data and
never prints a credential.

## When to run it

After a production deployment is READY, before calling a release complete. It
replaces the manual checklist that was used for the Studio M1–M7 releases:

| Dependency | What `verified` means |
| --- | --- |
| `ci_checks` | the repository’s completed PR gate run succeeded and its aggregate artifact identifies that run and attempt |
| `tested_merge_tree` | the checked-out Git tree in the successful artifact matches its Git object and the released tree. A manual run must use the exact release commit. A PR run must prove the tested merge lineage |
| `deployment` | a READY `production` Vercel deployment recorded for this commit carries the canonical alias (`aiso-kappa.vercel.app`) |
| `schema_gate` | the deployment's own build log says `schema gate: all N shipped migrations are recorded.` and N equals the number of `supabase/migrations/*.sql` files in the released tree |
| `worker_schedules` | the deployed Cloudflare Worker crons equal `cloudflare/aiso-worker/wrangler.jsonc` |

Any dependency that cannot be obtained is `unknown`, not assumed. A receipt
passes (exit 0) only when nothing failed and every unknown dependency was named
with `--allow-unknown`; a `failed` dependency can never be allowed away.

## Run it

Local (uses the `gh`, `git` and `vercel` CLIs you already use):

```bash
npm run release:receipt -- --app-sha <release sha> --gate-run <run ID> --scope <vercel team>
```

Use the full deployed commit SHA and the numeric run ID from GitHub Actions.
Download and retain `pr-gate-diagnostics` with the release record. A fresh run on
an exact commit is required when the original checkout object is unavailable or
when the release uses a squash or rebase.

Options:

| Option | Meaning |
| --- | --- |
| `--app-sha <sha>` | required; the commit production serves |
| `--gate-run <id>` | successful PR gate workflow run ID |
| `--pr <number>` | optional pull request reference for the receipt |
| `--allow-unknown worker_schedules` | record a missing Worker readback for diagnostics |
| `--repo <owner/repo>` | default: the `origin` remote |
| `--project <name>` | Vercel project; default `aiso` |
| `--scope <team>` | Vercel team; also read from `VERCEL_SCOPE` |
| `--canonical-alias <host>` | required alias; default `aiso-kappa.vercel.app` |
| `--out <path>` | default `.release-receipts/<sha>.json` (gitignored) |
| `--json` | print the receipt JSON instead of the summary |

Exit codes: `0` verified (or every unknown allowed), `2` failed or an unapproved
unknown, `1` usage error.

## CI workflow

Dispatch `pr-gate.yml` on the frozen candidate branch with `schema_only=true`
for the hosted synthetic fixtures. Schema-only fixtures are the default for pull
requests, manual runs, and local tests. The resulting run ID is the release input.

`.github/workflows/release-receipt.yml` is `workflow_dispatch` only: it never runs
on pull requests and never deploys. It needs repository secrets
`VERCEL_TOKEN` and `VERCEL_SCOPE`; `CLOUDFLARE_API_TOKEN` is optional and enables
the Worker-schedule check (otherwise pass `allow_unknown=worker_schedules` with a
reason). The receipt JSON is uploaded as an artifact for 30 days.

## Limits and honest fallbacks

- **Keep the immutable evidence.** Historical runs without a recorded checkout
  remain unknown. If the artifact or checked-out object expires, rerun the gate on
  the exact release commit and retain the new run ID and artifact.
- **Build logs expire.** If the deployment's log is no longer readable the schema
  gate is `unknown`; re-running the receipt cannot recover an expired log, so run
  it promptly after the deployment.
- **Cloudflare readback needs a token.** The check shells out to
  `scripts/worker-schedules.mjs --json`, which refuses to refresh an expired
  `wrangler login` on purpose. Use `CLOUDFLARE_API_TOKEN` in CI, or allow the
  dependency as unknown and record why.
- **Vercel needs an authenticated CLI/token.** Without `VERCEL_TOKEN` (or a
  logged-in CLI) the deployment dependency is `unknown`, not a pass.
- **`--allow-unknown` is not a bypass.** It is recorded in the receipt and keeps
  the overall status `unknown`; only the exit code changes. Never allow
  `ci_checks`, `tested_merge_tree`, `deployment` or `schema_gate` on a release
  that claims to be verified — an allowed unknown is a known gap for the
  reviewer, not evidence.

## What the receipt proves and does not prove

It proves the released commit, its CI evidence, the deployed artifact and the
database schema gate are the same release, and reports the data it read so a
reviewer can check it. It does not prove runtime behaviour: correctness of a
feature, provider connectivity, OAuth consent, Stripe configuration or
production data state still need their own acceptance (see
[development.md](../development.md) and the feature runbooks).
