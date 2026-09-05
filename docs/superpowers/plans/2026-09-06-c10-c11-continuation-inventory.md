# C10–C11 continuation inventory — 2026-09-06

Source inventory and final local readiness update, not operational acceptance. Checkout: codex/c9a-private-entities; base HEAD 5aabacd16d338afc15fbaa3d5db62641d7b5c628. C9a and bounded C10 fixes are an uncommitted review patch. No external action has been performed.

## C10 bounded source work

| Boundary | Verified local source | Remaining evidence / next action |
|---|---|---|
| Scheduler | cloudflare/cron-worker/src/index.ts maps three schedules to Pulse, alerts and trial emails; wrangler.jsonc defaults to https://aeo.fimmick.com | Actual deployed target, job execution and legacy n8n retirement unknown. Inspect existing tests for origin/auth/timeout and duplicate-work contracts before changing code. Do not infer retry/idempotency guarantees from comments. |
| Execution ledger | lib/cron/recordRun.ts returns null on failed start insert and logs failed completion | Missing row is not evidence of no invocation. Preserve existing job behavior; audit redaction and partial/no-op reporting with deterministic tests. |
| Repository gate | .github/workflows/pr-gate.yml aggregate needs static, unit-contract, integration, e2e-accessibility, build and cloudflare-worker | Required-check enforcement and current remote CI are not verified. No settings change. |
| Auth / billing | Existing Neon Auth and Stripe seams remain the source of truth; C8 settings uses commercial resolver | Carry forward existing test evidence only as local evidence. Audit failure contracts; live issuer/cookie/signup and Stripe test-mode replay need an exact isolated target and separate authorization. No SDK/price change. |
| Preview cleanup | Existing prune-preview-branches script and Neon test helper are referenced by the continuation plan | TTL, cleanup scheduling, orphan recovery and sterile parent require fresh inspection/proof. Do not create/delete branches. |
| New connector | No connector selected | GSC is a candidate, not a commitment. Provider, scopes, account ownership and revocation contract must precede implementation. |
| Credentials | Prior plan records legacy n8n token/DB-role obligations | Operator must confirm rotation/revocation and correct consumers. Do not retrieve historical tokens or treat removal from HEAD as revocation. |

## C11 release preparation

Recorded intended topology: Production stays on legacy red-firefly-93523049; Preview/Development intend AISO weathered-wave-50814522. These are document values, not live verified bindings. AISO synthetic parent is br-square-mountain-az6f82vi. Before the first customer write, establish a sterile non-production parent and stop deriving previews from customer data. The topology document's older 'at that moment' phrasing is superseded by this before-write gate from the continuation plan.

Readiness remains blocked on C1 current-head bootstrap/equivalence proof, exact environment identity and app role, schema/grants, real isolated Auth/billing/provider tests, scheduler evidence, named Product/Operations owners and canary/write-fence/recovery approval. C8 source/browser success cannot satisfy those gates. No remote check was run for this inventory.

Preserve recorded recovery targets: Production RPO<=5min/RTO<=60min and quarterly restore evidence; staging RPO<=24h/RTO<=4h and annual rehearsal; previews recreated. These are targets, not measured guarantees.

Every future external proposal must include exact project/branch/database/role/domain or provider account, pinned source diff, expected validation, failure/abort conditions, named owner and rollback including new writes. Unknown targets cannot be replaced by guessed IDs. No cutover, migration, deployment, credential operation, real email, paid scan, customer write, workflow retirement or branch cleanup is authorized by this inventory.

Local deliverables are recorded in 2026-09-06-c9a-c11-handoff.md with a base-specific patch and manifest. Operational proof remains separate.

## C9a release gate (local preparation)

Base checkpoint: 5aabacd (C8c–g). C9a source and migration040 will be a separate uncommitted review patch; a deployment SHA is not available until reviewed publication. Runtime activation is blocked until the target has the approved schema and app-role checks. No empty-entity fallback may hide a missing table.

| Gate | Current evidence | Required before external execution |
|---|---|---|
| Product scope | Private/unverified one-record-per-client design approved | No public verification, new roles or delivery claims in this slice |
| Source/regression | C10 existing mock suite: 10 files,145 tests passed in this run | Final local build, typecheck, lint,210 files/2248 unit tests and26 hydrated browser tests passed; see C9a-C11 handoff |
| Migration040 | Authoring only | Exact isolated project/branch/database/owner target, SQL diff, disposable proof and app-role grant verification; no application now |
| Baseline-to-head | C1 proof remains separate | Verify current-head equivalence including040 before release; no edits to baseline or old migrations |
| Activation | No deployment | Ensure approved target schema is present before code serving new entity route; no guessed production binding |
| Customer data | No customer write | Sterile nonproduction topology and system-of-record/write fences before first write |
| Recovery | No restore or rollback performed | Source rollback retains additive table/data; destructive schema rollback requires a separate retained-data plan and approval |
| Operations | Owner/canary/domain/budget unknown | Named Product/Operations owners and exact target, validation/abort/rollback package |

Local checks must not be relabeled as a canary, live provider execution or release approval. C11 is a readiness dossier with blocked evidence, not an executed cutover.

## Local audit outcome and operational limits

C10 narrow changes: raw cron-ledger database diagnostics are replaced with allowlisted fields; three Pulse failure ledger statuses corrected; disposable cleanup identity registration/deletion guards and structural pruner protections strengthened. Focused final5files/71tests passed. Independent spec/quality review passed after adding exact HTTP body assertions. Existing C10 mock suite10files/145tests passed separately. Worker6mock tests passed using already installed root Vitest because Worker-local dependencies were absent; no Worker install, deployment, runtime typecheck or actual scheduler invocation is claimed.

The helper/pruner regressions simulated protected/default/wrong-project responses. No branches were listed, created or deleted by this task. Pure tests and mocked commands cannot prove runtime parent sterility or deployed cleanup scheduling. The four C10 local repairs do not close live Auth/billing/provider proof, scheduler ownership/legacy retirement or credential obligations.

C9 exact-target integration uses a dedicated opt-in config with no provisioning hooks and is excluded from ordinary integration setup. It requires explicit approved project, branch, owner role and TEST_DATABASE_URL, then checks in-band identity/table ownership before fixture writes. Do not run until that exact disposable target and migration application are separately approved. It is authored but unexecuted here.
