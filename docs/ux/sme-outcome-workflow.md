# SME multi-source outcomes — approved development milestone

Approved 2026-11-14 after the three SME activation releases. Engineering starts
from actual main `73e97904550eff953ef70bf0ed74c62ea4b3eab3`; the
[activation receipt](https://github.com/YNWAforever/aiso/pull/267#issuecomment-6874734189)
is the release baseline. This document is a plan, not a claim that V2 outcomes or
human acceptance have shipped.

The owner should be able to finish a work item and explain what evidence exists,
what is missing and what to do next. The confirmed gap is that V2 frozen work can
be reviewed and exported, while the stored-outcome projector accepts only V1.
The current [projector](../../lib/outcomes/sources.ts) and
[response types](../../lib/outcomes/types.ts) are the implementation witnesses.

## Ordered releases

| PR | Deliverable | Completion evidence |
| --- | --- | --- |
| 1: baseline | Synchronize #267 release facts; dated capability/readiness ledger; blank trial observations and issue triage | Source/callee audit, distinct dated release evidence and explicit runtime unknowns; independent review and release gates |
| 2: backend | Read-only V2 stored outcomes, one result per frozen source, bounded reads and V1 compatibility | Contract/policy tests and disposable SQL integration; no production business write |
| 3: owner journey | Per-source V2 outcome presentation, actual-component offline sample and continuous V2 regression | Both locales/themes, independent actor views, errors/reload/withdrawal, inspected layouts and release evidence |

Each PR starts from the preceding actual merged main in an isolated worktree.
Human observations can run in parallel; absent participants do not block the
confirmed V2 engineering gap. The owner arranges participants. Chat/MCP/Skill UI
priorities will use actual observations, alongside source-confirmed engineering
issues recorded in the readiness ledger.

## PR1: evidence and trial preparation

[Capability readiness](sme-capability-readiness.md) distinguishes implementation,
controlled tests, dated canonical observations and unknown live dependencies.
Configuration shape, successful build, HTTP method and historical status copy are
not operational success. Inspect current callees, not just route names or comments.

Use the existing [seven-task script](sme-activation-usability.md) and
[observation template](sme-activation-observations.md). Keep records blank until a
real participant attempts the supplied sample. Record assistance, environment,
manifest and exact behavior before interpreting causes or proposing priorities.
The sample does not perform production sign-in, provider work, package downloads
or website changes.

## PR2: read-only response contract

Keep the existing version-outcomes GET endpoint and its session-derived account,
actor, brand, work-item, version and content-hash boundaries. V1 reads retain their
response shape, existing parser, clock/selection policy and presentation. Add a
separate V2 decoder for the service before the UI consumes it in PR3; an older UI
continues to reject unsupported results rather than invent a V1 projection.

V2 uses `schemaVersion: 2` and `policyVersion: stored-outcomes.v2`:

- Common fields: client/item/version identity, content hash, evaluation clock,
  anchor state and the validated same-version delivery anchor.
- `sources[]`: frozen array order, including duplicates. Each entry has its original
  `sourceIndex`, baseline, D7/D28/D56 windows, diagnostics, truncated state and
  reasons. Never rewrite a source or deduplicate approved content.
- No combined improvement score, package-wide success verdict or causal claim.
  Different subjects and kinds keep independent comparison results.

Project baselines from immutable frozen snapshots. Reuse the existing comparison
and microsecond window policy for each source. Pulse collection success remains a
collection state; missing collection time or provenance does not become comparable
business improvement. A new website read must never replace the frozen baseline.

### Bounded data and failures

- Read only the owned brand's stored, relevant observations. Scan candidates are
  shared; Pulse candidates match frozen question/platform/prompt subjects.
- Retain a maximum of 200 candidates plus one truncation sentinel **per kind per
  read**, not per source. Do not multiply SQL result budgets by the source count.
- Apply the existing diagnostic ceiling of 400 globally for a V2 result. Selection
  and allocation must be deterministic and expose affected limitations.
- When a kind's read is truncated, affected sources stay evidence-limited; missing
  rows cannot support an exhaustive "no observation" or "no improvement" claim.
- Invalid primary version/tenant/hash/anchor state fails the whole read. A malformed
  frozen version remains a version failure. Missing or malformed observation data
  affects its source without hiding valid sources.

Expected scope is application SQL/read projection, pure policy/decoders and their
contracts/tests. **No migration, new table or write API is planned.** If evidence
requires one, present the concrete revision before expanding the approved scope.
Existing export bytes, draft/review/delivery writes, grants, entitlement, billing,
providers and schedules retain their contracts.

## PR3: owner presentation and regression

Show the recorded delivery anchor and evidence limits first, then the frozen
sources. Distinguish not due, awaiting observation, no retained observation in the
window, not comparable and temporarily unavailable. Keep IDs/hash in details.
A refresh reads stored evidence only; it never starts a scan, collection or provider.

Keep V1 behavior, dirty review/delivery fields, retry identity, late-completion and
scope fences, and SME flag rollback. Validate response identity, frozen source
indexes and version/hash before accepting V2 data.

Extend the actual-component sample and real Node factory/freezer journey through
multi-source draft, independent review, self-reported delivery, per-source outcomes,
reload and withdrawal. Cover mixed kinds, duplicate sources, unavailable data,
truncation, old callbacks and read errors. The offline actor selector is still a
demonstration control, not authentication or permission proof.

## Verification and release

Use appropriate full local lint/type/text/unit/build checks, real fixture generation
and relevant browser regression. Unit/contract coverage includes V1 compatibility,
V2 ordering/duplicates, isolation, invalid identity, malformed observations, clock
boundaries, truncation, withdrawal and historical versions. Disposable SQL tests
exercise actual queries, frozen V2 data, ownership/subject filtering and row budgets.
Never substitute a customer database for the integration target.

Browser coverage includes en/zh-HK, light/dark, 320/390/768/1440 widths, keyboard and
focus, 44px controls, axe/reflow, preserved inputs, scope changes, exact anchors and
reload. Independent review and all ten required exact-head CI jobs precede a fresh
head/base/CLEAN matched merge. Verify candidate/CI/actual tree equality, exact
canonical Ready SHA, its production schema log and explicitly allowlisted reads.
Retain failures honestly; no skips or fixture receipts become live provider proof.

## Human acceptance and authority

Human usability is pending until real observations exist. Proposed acceptance is
at least four of five actual SME participants independently resuming work,
explaining the blocker, choosing the prompted manual route and distinguishing
self-reported delivery, live verification and retained outcomes. Use the common
scoring rules in the observation template; automation is separate evidence.

This milestone authorizes implementation, isolated tests, deployment and the
existing guarded release reads. It does not authorize production draft/review/
export/delivery/ROI writes, token minting or audited MCP calls, invitations/messages,
grants, configuration/provider/schedule changes, live checks/handoffs or paid work.
Any such operation needs a separately named brand, action and workload. Readiness
unknowns remain explicit without activating services to fill the table.
