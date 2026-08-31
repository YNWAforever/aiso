# Phase 0 close-out — design

**Status:** Approved 2026-08-31
**Author:** Claude Code, acting under the Fimmick AISO execution prompt
**Governs:** completing all remaining Phase 0 items of the base plan
[`docs/superpowers/plans/2026-08-30-aisogpt-aiso-new-neon-integration.md`](../plans/2026-08-30-aisogpt-aiso-new-neon-integration.md)

## Context

Items 0.1 (ADRs) and 0.2 (documentation drift) are already complete on local branches
(`claude/neon-integration-phase0`, `claude/plan-0.2-doc-drift`). Ten Phase 0 items remain:
0.3–0.12. Of these, only 0.3, 0.7, and 0.9 were unblocked under the wrapper's default
Authorization-block-unfilled restriction; the rest need explicit work-item authorization,
and 0.6 additionally needs 0.4 to land first.

The stakeholder (sole approver for this project) has:
- chosen to close out the whole of Phase 0 in this pass, not just the pre-authorized subset;
- confirmed they are the sole approver for all §24 decisions;
- confirmed full Neon and GitHub access is available, so no item needs to defer verification
  for lack of credentials;
- chosen to record all 13 §24 decisions now, using the plan's recommended defaults.

## Decision record artifact

A new file, `docs/decisions/2026-08-31-phase0-stakeholder-decisions.md`, is the single
persistent record of two things: the 13 §24 decisions (recommended defaults, approver, date)
and the filled Authorization block for this phase of work, so a future session can read it
instead of re-deriving authorization state.

| # | Decision | Recorded default |
|---|---|---|
| 1 | Canonical repo | `aiso` — Approved |
| 2 | Neon project/region/topology/owner | `fimmick-aiso-v2-prod` + non-prod; AWS region (exact region selected at implementation time, item 1.1 — a technical lookup, not a stakeholder call); budget owner = the stakeholder |
| 3 | Bootstrap strategy | Option A, clean greenfield |
| 4 | Identity migration | Fresh identities, no migration |
| 5 | Production data copy | None — Approved |
| 6 | RLS vs explicit scoping | Keep explicit scoping; defer RLS |
| 7 | Scoring/pillars | Approved; adopt coverage-gate semantics |
| 8 | Route classification | Per §9 matrix as written |
| 9 | n8n/cron ownership | Retire n8n Pulse; Cloudflare owns scheduling |
| 10 | Stripe catalogue | Unchanged — Approved |
| 11 | Locale/redirect/rollback policy | Keep `en` default; 308/307 split as specified; internal dark-launch |
| 12 | Cutover posture | Separate v2 now; cutover approved separately later |
| 13 | Non-prod topology/RPO/RTO | Sterile-parent non-prod project; RPO/RTO per §16.3; budget owner = the stakeholder |

**Privacy note.** `aiso` is a public GitHub repository. The approver field in the decision
record uses a role label ("Product Owner") rather than the stakeholder's personal contact
information.

The same file's Authorization section will read:

```
APPROVED DECISIONS (plan §24):     1-13, per table above
APPROVED PHASE:                    Phase 0 (all items)
APPROVED WORK ITEMS THIS SESSION:  0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.10, 0.11, 0.12
                                    (0.1, 0.2 already complete)
NEON RESOURCE CREATION:            NOT AUTHORIZED
DONOR CHECKOUT AVAILABLE AT:       not available
```

Neon resource creation stays explicitly unauthorized regardless of the 13 decisions being
recorded — decision approval and resource-creation authorization are separate lines in the
wrapper's own Authorization block, and creating billed cloud infrastructure needs its own
explicit go-ahead when Phase 1 actually starts.

## ADR status flips

Each of the 8 ADRs that named a §24 approval gate (001, 002, 006, 007, 008, 009, 010, 011)
moves from `Status: Proposed — pending §24 decision N` to
`Status: Accepted — §24 decision N approved 2026-08-31`, referencing the decision record file.
`docs/adr/README.md`'s status column is updated to match. ADR-003/004/005 (no gate) are
unaffected.

## Plan changelog and the D14 gap

Item 0.2's report flagged a real drift the plan's own table missed: `README.md` still claims
"There is no CI" and "The app connects as `neondb_owner`", both contradicted by
`.github/workflows/pr-gate.yml` and migration `037`. Per §7, this is recorded as a dated
changelog entry appended to the base plan file (classified `stale`, proposed fix: correct
both README claims). The actual README fix lands as its own tiny housekeeping commit,
separate from any single work item's diff, so it doesn't inflate that item's scope.

## Execution sequence

The remaining ten items execute in this dependency-respecting order:

```
0.4 → 0.5 → 0.6 → 0.12 → 0.10 → 0.3 → 0.7 → 0.8 → 0.11 → 0.9
```

Rationale: 0.4 (pillar-snapshot persistence) is one of the plan's two hard gates (§19) and is
pulled to the front since it gates all future result-page work and is rated High/High in the
risk register (R2). 0.5 and 0.6 build directly on it. 0.12 (score-cap centralisation) and
0.10 (typecheck tests) are small, dependency-free fixes grouped next. 0.3, 0.7 feed the
critical path toward 0.8 (harness parameterisation) and 0.11 (CI integration gate). 0.9
(feature flags) closes the phase since nothing else depends on it.

Each item gets its own commit on its own branch stacked on the current tip (continuing the
pattern from 0.1/0.2), one PR-sized diff per item, nothing pushed to the remote until the
stakeholder says so. Each item's goal/deps/acceptance criteria are restated from plan §19
before its files are touched, per the execution prompt's §6.

## Verification notes

- **0.8** exercises the repository's existing integration harness, which provisions a
  disposable branch in the *existing* Neon project — not a new v2 project — exactly as
  `README.md`'s "Integration tests need `neonctl`" section already documents. This is
  pre-existing, already-authorized repo behaviour, not new capability; it simply hasn't been
  exercised in this session because `neonctl` wasn't authenticated before.
- **0.11** adds `NEON_API_KEY` as a GitHub Actions secret. That is a standing-configuration
  change on a shared system, so it needs its own explicit go-ahead at the moment it happens,
  even though this design pre-approves the work item itself.
- Every item still runs `npm run lint`, `npm run typecheck`, and `npm test` locally per plan
  §6/§20, with the pre-existing Windows CRLF failure in `pr-gate-workflow.test.ts` treated as
  a known, already-diagnosed environment artifact (see memory: `aiso-windows-crlf-test-failure`),
  not a regression signal.

## Explicitly out of scope

Phase 1 (any real Neon resource creation) stays not authorized regardless of decisions
recorded. Legal-copy sign-off (plan item 2.10), the role-model / ownership-verification /
retention-policy open questions (plan §25), and everything in Phase 2 onward remain
untouched by this close-out.
