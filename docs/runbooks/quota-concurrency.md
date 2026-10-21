# Local PostgreSQL quota acceptance

The **Quota concurrency** workflow runs a separate acceptance job on an ephemeral Ubuntu 24.04 runner with Node 24 and PostgreSQL 16. It uses no database URL, Neon resource, secret, or production deployment. It does not change `PR gate` or branch-protection requirements.

**Execution status:** adding this workflow is not a passing concurrency result. T05 stays open until an actual run produces the acceptance evidence below. Local preparation checked syntax, lint and workflow parsing; the preparation executor maps only root, so PostgreSQL's non-root startup requirement prevents a real local run there.

## Run and scope

Pull requests touching `app` callers, `lib`, migrations, relevant tests, package files or this harness trigger the workflow. It can also be dispatched manually once available on the default branch. The broad caller paths avoid silently skipping a changed quota-receipt call site. The SQL harness itself does not exercise HTTP routes; their unit tests remain necessary.

For a non-root Linux checkout with PostgreSQL 16 and `npm ci` already completed:

```sh
node scripts/ci/verify-quota-concurrency.mjs . /usr/lib/postgresql/16/bin /tmp/aiso-quota
```

The final argument must stay short: Linux Unix socket paths, including the socket filename, must occupy fewer than 108 bytes. The harness checks this before initialization. CI installs the official `postgresql-16` package only if the required binaries are missing; it starts its own cluster under the normal runner account.

The harness imports the **actual quota TypeScript module**, replacing only its `db()` transport with a per-session `pg` tagged-template adapter. It executes **migration025 verbatim** after creating a minimal `accounts(id uuid primary key)` parent. This is quota SQL/locking acceptance, not a full schema replay, production-role grant check or Neon transport test.

The quota and migration contents are pinned by Git blob hash in the script. The reference commit identifies those two reviewed contents, not the current checkout HEAD. An intentional change to either file must review and update its pin; changing a pin alone does not establish acceptance.

## Identity and acceptance evidence

Before constructing any client, the harness verifies its newly created private directories, postmaster PID/UID/executable/command line, exact configuration, disabled TCP, private Unix socket and cluster system identifier. Each connected session then confirms that same server identity before writes. It requires **17 distinct live backend PIDs**.

Ten cases cover concurrent admission caps; consume/refund orderings at a full cap, one remaining slot and the last reservation; simultaneous refunds; account separation; UTC month selection; prior-period refunds; and account-scoped expired-row cleanup. Ordered cases observe an actual backend waiting on a PostgreSQL lock before releasing the first transaction. The server clock is not advanced across a real month boundary.

Accept a run only when its job succeeds and all of these hold:

- `report.json` has `status: "passed"`, ten passed case records, 17 unique backend PIDs, and `clusterStopped: true`.
- `identity-before-client.json` matches the report's server identity and all connected sessions' system identifiers.
- The final account-scoped row snapshot contains only counts from 1 through 3; fully refunded rows are absent.

Missing, skipped, blocked or failed execution is not a pass. The report records the source blobs, generated fixture IDs, observed lock waits and final row state. Use the workflow run's checkout SHA alongside these receipts when linking acceptance to a PR revision.

## Cleanup and diagnostics

The script closes clients and stops only its exact owned postmaster in `finally`, including a failed `pg_ctl start` that left a verifiable server running. It never stops package-managed PostgreSQL services. A changed server identity fails closed instead of stopping an unrelated process. Cancellation or hard executor termination may prevent `finally`; the ephemeral runner must then be discarded, and that run provides no acceptance.

CI uploads only `report.json`, `identity-before-client.json` and `postgres.log`, retained for 14 days. It never uploads cluster data files. Local cluster files remain under the generated `quota-pg-*` directory for investigation; remove only your own recorded directory after confirming its postmaster has stopped.
