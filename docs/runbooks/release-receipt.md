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
| `ci_checks` | every GitHub check run on the PR head (or the commit, when it has no PR) is `success` |
| `tested_merge_tree` | the release merge commit's second parent is the tested PR head **and** a tested tree (PR merge ref, pinned ref, or local `git merge-tree` reconstruction) equals the released tree |
| `deployment` | a READY `production` Vercel deployment recorded for this commit carries the canonical alias (`aiso-kappa.vercel.app`) |
| `schema_gate` | the deployment's own build log says `schema gate: all N shipped migrations are recorded.` and N equals the number of `supabase/migrations/*.sql` files in the released tree |
| `worker_schedules` | the deployed Cloudflare Worker crons equal `cloudflare/aiso-worker/wrangler.jsonc` |

Any dependency that cannot be obtained is `unknown`, not assumed. A receipt
passes (exit 0) only when nothing failed and every unknown dependency was named
with `--allow-unknown`; a `failed` dependency can never be allowed away.

## Run it

Local (uses the `gh`, `git` and `vercel` CLIs you already use):

```bash
npm run release:receipt -- --app-sha <merge sha> --scope <vercel team>
```

The production merge SHA is the `Merge pull request …` commit on `main`, not a
PR head. Example for the M7 Studio release:

```bash
npm run release:receipt -- \
  --app-sha 06d86af5483f7a59f0e11efdcbf3a95aa9c527ea \
  --scope ynwaforevers-projects \
  --allow-unknown worker_schedules
```

Options:

| Option | Meaning |
| --- | --- |
| `--app-sha <sha>` | required; the commit production serves |
| `--pr <number>` | read CI evidence from this PR instead of resolving the commit's PR |
| `--tested-merge <sha>` | pin a tested merge ref (audit re-runs of an old release) |
| `--allow-unknown <ids>` | comma-separated dependency ids allowed to be unknown; print the reason in the run log |
| `--repo <owner/repo>` | default: the `origin` remote |
| `--project <name>` | Vercel project; default `aiso` |
| `--scope <team>` | Vercel team; also read from `VERCEL_SCOPE` |
| `--canonical-alias <host>` | required alias; default `aiso-kappa.vercel.app` |
| `--out <path>` | default `.release-receipts/<sha>.json` (gitignored) |
| `--json` | print the receipt JSON instead of the summary |

Exit codes: `0` verified (or every unknown allowed), `2` failed or an unapproved
unknown, `1` usage error.

## CI workflow

`.github/workflows/release-receipt.yml` is `workflow_dispatch` only: it never runs
on pull requests and never deploys. It needs repository secrets
`VERCEL_TOKEN` and `VERCEL_SCOPE`; `CLOUDFLARE_API_TOKEN` is optional and enables
the Worker-schedule check (otherwise pass `allow_unknown=worker_schedules` with a
reason). The receipt JSON is uploaded as an artifact for 30 days.

## Limits and honest fallbacks

- **The PR merge ref disappears after merge.** GitHub deletes
  `refs/pull/<n>/merge` once the PR merges, so a post-merge receipt first tries to
  fetch it, then replays the merge locally with `git merge-tree --write-tree
  <first parent> <tested head>` and compares the resulting tree. A squash or rebase
  release has no second parent, so the dependency is `unknown` rather than assumed.
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
