# Implemented Pulse contract (T05/T07/T08)

FEATURE_PULSE_ATTEMPTS remains off outside isolated acceptance. Migrations 057/058 must be verified before this candidate. The source supports weekly dispatch and daily repair; the dedicated Worker still has an empty cron array. No app/Worker production deployment or provider call was made during remediation.

Each client/week has one immutable manifest: active question text, category, language, market (unknown until explicitly recorded), brand metadata and requested API model variants. Actual served model/request/usage belong to attempts and may be null. No API sample is a consumer-product ranking. Legacy rows retain their original data and have no invented manifest or model denominator.

An item has at most three collection attempts, with 60/300/1800-second backoff. Each collection reserves at most 500 output tokens; classification reserves at most 300. At the 50-question × 5-variant maximum, the collection ceiling is 250 × 3 × 500 output tokens plus bounded classification, not a promised monetary charge. Missing/uncertain usage and cost stay null. Database acceptance is fenced and unique; external provider billing is not exactly once.

The consumer has a 45-second deadline, reserves five seconds for checkpoint persistence, and stops claiming with fewer than ten seconds left. A collector that ignores cancellation is raced against its deadline; a late answer cannot commit after the timeout. Successful raw evidence is committed before analysis. Classification failure does not recall the provider or delete the answer.

Weekly enqueue intent is persisted in cron_runs before work begins. It records the original UTC Monday, candidate keyset cursor and clients whose manifest write failed. Repair can finish that saved weekly intent and its original run; a daily trigger with no saved intent does not start a new week's Pulse. Compare-and-set prevents a late dispatcher overwriting a newer enqueue checkpoint. A saved run cursor rotates processing among brands; reaching the end clears it for the next pass. Lost HTTP acceleration affects throughput; a new daily consumer can recover from the database.

Cross-account discovery is deliberately machine-only: queue.readPulseTarget, queue.listPendingRunPage and dispatch checkpoint functions are reachable from the cron-secret-authenticated entrypoint. They resolve each account through its client and re-evaluate the central commercial entitlement. All item, attempt, raw projection and classifier writes carry the resolved account/client scope. No session API can invoke machine discovery. The SQL inventory and secret/header tests cover this boundary.

Cron summaries record complete/partial/failed/blocked, remaining work, failures, coverage and original run IDs. A chain cap is partial, never a full success. Partial/blocked invocation records use cron_runs.status=error with a specific outcome; old status vocabulary/schema remains compatible. The Worker reports the outcome response header without reading customer answers.

Alert evaluation requires a positive, wholly successful and classified manifest denominator. Partial/current raw-only runs and legacy rows without manifest proof cannot create definite threshold/change/recovery alerts while the ledger flag is on. Unknown classifications remain a gap until T08's classifier and saved-answer retry are applied.

Isolated proof: T05 fixed manifests/concurrency/raw persistence; T07 45-second budget fixture, three-attempt backoff, lost-self-call/new-consumer repair of the original week, and enqueue checkpoint fencing. Formal role login, actual provider responses, deployed Worker schedules, job coverage and independent role UAT remain separate gates.

Rollout: replay expand migrations on the approved isolated target; verify ledger, column grants and actual application role; deploy a candidate with fake providers; inspect whole-candidate run coverage. Production requires the reviewed exact app/Worker SHA, one producer per job, verified binding, individually authorized provider/email mode and explicit activation. Keep the dedicated cron configuration empty until approval.

Rollback: disable the flag and stop the new producer before restoring the previous entrypoint. Retain manifests, attempts and successful observations. Do not delete ledger rows, reset trials, roll back old deployed migrations or start a second producer against the same live database.
## Classification repair (T08)

Classification uses the saved accepted answer and frozen brand identity. Its
attempt count, fenced lease and append-only history are independent of collection;
retrying it does not call the collection provider. Three classification attempts,
300 output tokens each, 15 seconds per invocation, and 60/300/1800 second backoff
bound work. Late results cannot replace a newer lease or a classified result.
Interrupted external classification spend is unknown, never asserted to be zero.

Only `classified` contributes to the mention denominator. Emotion uses classified
brand mentions with positive/neutral/negative sentiment. Fallback, failed and
legacy_unknown keep evidence but contribute to neither denominator. Raw sample
counts remain visible independently. Raw completion with unclassified samples is
a partial operational outcome, and legacy summaries without manifest proof cannot
fire a definite alert. No private entity alias is inferred as measurement identity.

The offline evaluation has 120 synthetic, unreviewed labels: en/zh-HK 60 each,
six categories 20 each. Fixture responses test parser and fallback safety. The
reported precision/recall of 1.0, 40 abstentions and zero mismatches describe these
fixtures only, not live classifier accuracy or a gold set. Independent label
review and bounded live-provider evaluation remain pending. See the sibling
`pulse-analysis-evaluation.json` for counts and confusion matrices.

Migration 058 is required before this application candidate, including its
compatibility writer. It expands metadata and preserves historical rows as
legacy_unknown; it never fabricates an applied-schema baseline. Rollback may
disable new collection/repair and restore the previous application while keeping
the audit and classification tables and all successful answers.
