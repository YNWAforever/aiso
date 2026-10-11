# Release and rollback packet — NO_GO pending external gates

Code candidate: b949145e5cae37d30276e3218403808448fde71e. Audit: 783e54e3fa99f8c14e4cab84a67b42b0b1513c3c. Main base: 27dd057fa6d5ecaae5bbd342e25cc8579e529d3a. Draft PR86: https://github.com/YNWAforever/aiso/pull/86 . Later evidence-only commits do not change the code tree; verification-summary.json records the source fingerprint and final CI head.

This packet prepares execution; no production migration, merge, provider smoke, cron trigger, Worker publication or email/publication has been performed in this session. Local SQL and a protected static fixture preview are available. A hosted authenticated transactional preview and the remaining gates below must pass before production release. Never promote the static fixture project to the application alias.

## Target and authorization requirements

The approved production database project/branch/database/role and current pending migrations are UNRESOLVED. Existing production Vercel alias points to main27dd057; see deployment-readback.json. Current production feature flags are UNVERIFIED. Worker readback has an untagged Secret Change version, not a candidate Git binding. These uncertainties block an executable production invocation, not the implementation or review.

Before any external writer action, prepare a private packet with exact code SHA, Vercel deployment and alias, Neon project/branch/database/role, ownership, migration hashes, backup/restore receipt, provider manifest/cap, Worker account/name, config diff, request hash, one-run time window and operator. Bind credentials to that packet through the existing secret-management path. Do not commit DSNs, tokens, passwords, account/customer raw answers or private target metadata. Do not reuse approval from a prior run. An unknown external outcome is reconciled read-only before any retry.

## Migration order and read-only preflight

Additive packet, applied and read back only on the task-owned loopback PostgreSQL fixture:

| Migration | SHA256 |
|---|---|
| 063_search_execution_evidence.sql | 42cdf92fa9e445afd29e0fb982dacfe5f79ef44f403396dee5e15b142fd0225c |
| 064_onboarding_intent_hash.sql | 6c39b3478a124f72ca230e64665aa97781387d391dad9a340c58f28807a2d67c |
| 065_pulse_run_identity_and_repair.sql | fef05656b8e87e3fccadb4a1eeaec11b881206bad2c5a506dfa9fc8f3ba00072 |
| 066_pulse_attempt_grounding_grant.sql | fc929b15d4f2695581aefdb3dcf0e6363a5c3dd2bf42160e35d495e7a2ea7552 |
| 067_user_pulse_intents.sql | 4fb09021f3b076d7f6a921bb3339034ab4b6258a4c3df770e90ab9b483bc850c |
| 068_prompt_batch_intents.sql | 18b6e8648e45ab4a2f134520c19f00470b92a3914cc7bef5e3196f0b89588e75 |
| 069_grouped_work_operations.sql | 14ad33c1825eefb8465b8501bbc5993dbf773b7957aa4bccd14d85d851779e09 |
| 070_onboarding_recovery_intent_aliases.sql | b7d40d330f023d8f36e5c143938bf84eef635c33295da78f1c7039370dafc400 |

The runner applies ALL pending files in sorted order, not a selected range. Stop if the actual pending list is not exactly the approved packet. Do not baseline an unfamiliar database, drop tables or assume that063 is its first pending migration.

Important: scripts/migrate.ts creates schema_migrations before processing --verify or --dry-run. Those options are not guaranteed read-only on a database without the ledger. Do not use them as an unapproved production probe. First use an approved read-only SQL session:

~~~sql
BEGIN READ ONLY;
SELECT current_database() AS database_name, current_user AS role_name,
       current_setting('neon.project_id', true) AS project_id,
       current_setting('neon.branch_id', true) AS branch_id,
       to_regclass('public.schema_migrations') AS ledger;
COMMIT;
~~~

Match all identity fields to the private approved packet. If ledger is absent or identity is missing, stop. When the ledger exists, separately read filename/applied_at from schema_migrations in a READ ONLY transaction and compare it with the repository file list. Capture applied relations, grants and schema fingerprints as well as ledger rows. A missing or untrusted baseline is a separate remediation, not permission to apply all migrations.

After explicit migration authorization and backup, use an ignored scoped secret file (never default .env.local). Set the scoped MIGRATE_DATABASE_URL owner connection through the approved secret-management path and clear any conflicting inherited value. The runner requires MIGRATE_DATABASE_URL; DATABASE_URL is the least-privilege application binding and is not used for migration. Run once, preserving redacted output:

~~~powershell
node --env-file=.env.release-approved scripts/migrate.ts --verify
node --env-file=.env.release-approved scripts/migrate.ts --dry-run
# Execute the next line only when target, exact pending list, hashes and approval match.
node --env-file=.env.release-approved scripts/migrate.ts
node --env-file=.env.release-approved scripts/migrate.ts --verify
~~~

No production dry-run is claimed. Local packet has eight applied migrations and zero pending. Verify aeo_app grants and every account-scoped owned-success/foreign-denial control on the approved isolated target before enabling writers.

## App, flags and Worker sequencing

1. Deploy compatible schema/readers to the approved isolated application preview. Keep new writer flags off. Verify legacy scans, original work-item snapshots and account ownership with real Auth sessions. Current static preview establishes components/CSS only.
2. On that isolated target, verify FEATURE_PULSE_ATTEMPTS=1, FEATURE_PULSE_GROUNDING=1 and WORK_ITEM_MULTI_SOURCE_V1=1, then run UC01–UC13 with approved synthetic accounts. Record role, expected/actual, timestamp, deployment SHA, SQL target and provider mode. Confirm duplicate intent, lost response, foreign scope, preserved raw repair and same-week retest controls. Flags off do not by themselves stop every legacy producer.
3. After hosted acceptance and six-class exact-head CI, approve merge/app deployment explicitly. Recheck main drift and preserve PR85 DNS readiness. Record the actual deployed SHA and alias readback. Do not count a READY deployment or HTTP200 as the user journey.
4. Publish only the existing dedicated cloudflare/aiso-worker/wrangler.jsonc profile after app/schema health, with the exact reviewed source SHA and CRON_SECRET mapping. The template cloudflare/cron-worker/wrangler.jsonc targets another name and must never be used for AISO activation.

~~~powershell
node cloudflare/cron-worker/node_modules/wrangler/bin/wrangler.js deploy --dry-run --config cloudflare/aiso-worker/wrangler.jsonc
# Only after separately authorized Worker publication:
node cloudflare/cron-worker/node_modules/wrangler/bin/wrangler.js deploy --config cloudflare/aiso-worker/wrangler.jsonc
node cloudflare/cron-worker/node_modules/wrangler/bin/wrangler.js deployments list --config cloudflare/aiso-worker/wrangler.jsonc
~~~

The dry-run above passed locally. The deployed profile has only17 4 * * * and47 7 * * 1. The existing daily Pulse trigger dispatches collection and bounded raw-only repair independently. The09:00 trial-email/Search Console template trigger remains disabled. controller.noRetry() is called before network work; app ledgers own retries/repair. Code/tests do not establish a real scheduled receipt. Actual producer inventory must rule out overlap with Vercel/n8n before any activation change.

## Bounded provider and schedule acceptance

Real provider smoke remains BLOCKED pending an exact approved synthetic brand/account, prompt/language/market/platform/model manifest, maximum answer count, token/currency cap and operator. A workload ceiling is not a currency cap. Retain actual model, requested/confirmed search, run/item/attempt IDs, raw hash, classification counters, usage/cost and timestamps. No auto retry when collection outcome is unknown; classification-only repair reuses saved raw. Never turn citations or requested search into confirmed execution.

Correlate at least one real scheduled Worker execution or an explicitly approved controlled trigger with app response outcome and persisted run/item/attempt completion. Flag-off/skipped,2xx alone and repo cron strings are not acceptance. Retests must remain outside canonical summaries. Email, webhook, CMS publication and payments are separate authorizations and are not needed for this audit repair acceptance.

## Rollback preparation and execution boundary

No hosted rollback rehearsal is claimed. Before release, record compatible app/Worker deployment IDs and rehearse legacy readers on the approved isolated migrated schema. Baseline27dd057 is not a safe long-term truthfulness rollback because it predates T01/T02. A compatible rollback must preserve unknown/partial display rules, raw answers, attempts, citation sources, intent receipts and draft versions.

Stop new dispatch/entry points first AND suspend the affected existing Worker producers. Setting FEATURE_PULSE_ATTEMPTS=0 alone can leave legacy collection active. A concrete Pulse-only pause config is prepared in evidence/rollback-worker-pause-pulse.json and its local dry-run passed (evidence/R01-rollback-worker-dry-run.log). It preserves account/name/main/secret mapping and removes only17 4 * * * while retaining47 7 * * 1. Publish it only under explicit rollback authorization: `node cloudflare/cron-worker/node_modules/wrangler/bin/wrangler.js deploy --config docs/remediation/2026-10-11/evidence/rollback-worker-pause-pulse.json`. A full triggers.crons=[] suspension also stops alert evaluation and therefore needs that exact scope approved; a Pulse-only suspension preserves47 7 * * 1. Validate the pause artifact with --dry-run before publication. Do not deploy the template or invent a new cron to pause another.

After explicit rollback authorization: publish the approved pause config, reconcile in-flight unknown outcomes read-only, disable relevant new-entry flags, then roll app/Worker back to the recorded compatible deployments. Preserve additive tables and immutable evidence; do not drop migrations or fill UNKNOWN with0. Verify alias SHA, Worker active version/schedules and owned/foreign read controls. Re-enable dispatch only after a new exact-target release approval and ledger reconciliation.

## Remaining release gates

- Final exact-head PR gate: all six classes plus aggregate, zero skipped required tests.
- Authenticated isolated hosted UC01–UC13, including owner/second tenant, Pro second brand and mobile/keyboard behavior.
- Approved production DB identity, baseline/pending list, backup, grants and compatibility rehearsal.
- Approved provider budget/provenance smoke and actual Worker scheduled/controlled receipt.
- Production flags, deployed source SHA, alias and compatible rollback targets.

Release remains NO_GO until those gates have evidence. No finding is verified_live in this session.


Candidate update: b949145 includes test-fixture corrections over the application candidate f0ed5c7. The preceding CI38147437065 failed integration18/419 while E2E938/938 passed; fresh exact-head CI is mandatory. The protected static preview was rebound to b949145 with117 asset checks and48 presentation checks. No test failure is relabeled as an environment blocker.
