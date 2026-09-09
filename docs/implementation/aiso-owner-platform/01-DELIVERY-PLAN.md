# 01 — Delivery plan

The supplied implementation plan reconciled against what this repository actually
contains. Read `00-BASELINE-AND-GAPS.md` first: much of Phase 1 packages D and E is
already built, so this plan is deliberately smaller than the generic one.

## 1. What changed versus the supplied plan

| Plan assumed | Reality | Effect |
|---|---|---|
| Modules live under `src/lib/aiso/*` | there is no `src/` | extend the modules in `00`§3.1; create no new top-level directories |
| Work, versions and approval need building | built, enforced by composite FK + GRANT | package D becomes **KEEP + one fix** |
| Export needs building | built, refuses unapproved versions, returns an artifact digest | package E's export becomes **EXTEND**, not BUILD |
| Recheck needs wiring | `compareScanEvidence()` can never return comparable | package E's recheck is the **largest single build** |
| Scanner needs freezing | no corpus existed | **done this session** |
| Claim flow exists and is safe | an absent cookie bypassed the check entirely | **fixed this session** |

## 2. PR sequence

Each slice is independently reviewable and independently revertable. Slices 1 and 2
are landed; the rest are ordered by dependency, not by value.

| # | Slice | Package | Depends on | State |
|---|---|---|---|---|
| 1 | Claim-intent mandatory on both paths; SSRF fence widened; scan compatibility freeze | A | — | **LANDED** `379887c` |
| 2 | Phase 0 documentation set | — | 1 | **LANDED** |
| 3 | Apply migrations 040–043 to the development database; run the integration project | — | operator approval | **BLOCKED** — §4 |
| 4 | Recheck comparison adapter: `comparison_status` + `outcome`, wired through `lib/outcomes` | E | 3 | designed, §3 |
| 5 | Owner Home: three priorities and one primary next action, specialist drill-down preserved | B | 3 | not started |
| 6 | Approved source pack: provenance, version hash, freshness, revocation, agent-use flag | C | 3 | not started |
| 7 | Export receipt: persist the rendered-artifact hash and an export event | E | 3 | not started |
| 8 | Separation of duties: editor-cannot-approve, distinct from submitter-cannot-approve | D | 3 | not started |
| 9 | Minimum agent-safety evaluation: grounding, abstention, injection, forbidden tools, budget | A/D | 6 | not started |
| 10 | Activation telemetry, plus bilingual and mobile verification | F | 5–7 | not started |

Slices 4–8 are each a vertical: view model, service, store, route, UI, tests.

## 3. Slice 4 in detail — the recheck adapter

The one genuinely novel piece of design, so it is specified here rather than
discovered later.

**The blocker is representational, not algorithmic.** Evidence stores an origin only
(`URL_REDACTION_VERSION = 'origin-only.v1'`), so two scans cannot be proven to have
hit the same *page*, and `compareScanEvidence()` honestly refuses with
`final-path-identity-withheld`.

**The narrow, honest opening.** `describeEvidenceUrl()` already records
`pathRedacted`, `queryRedacted` and `fragmentRedacted` as booleans. When all three are
`false` the target was exactly `https://origin/` — identity is fully determined
without storing a path. That yields a provable same-target comparison for root
targets and preserves today's refusal for every deeper URL.

**Vocabulary** (the brief's, not a new one):

    comparison_status = comparable | partially_comparable | not_comparable | insufficient_evidence
    outcome           = improved | unchanged | regressed | not_yet_observed | cannot_determine

**Rules.** `comparable` requires: both envelopes parse; identical
`comparisonSignature` (which already covers scanner version, all 20 check versions,
headline and pillar method, industry, region, sitemap source and origins); both
collections `complete`; the same check subject; and both targets unambiguous roots.
Non-root but otherwise matching is `partially_comparable`, carrying
`final-path-identity-withheld` as a stated limitation. Anything else is
`not_comparable` or `insufficient_evidence`.

Outcome ranks `fail < warn < pass`; `not-applicable` and `not-verifiable` are not
rankable and yield `cannot_determine`. **Content hashes are never compared** — page
content is expected to change; only method, target and configuration are.

**Constraint to respect.** `lib/outcomes/dto.ts` re-runs `evaluateOutcomes()` and
compares field by field, so a new window field must be added in five places at once:
`types.ts`, `evaluate.ts`, `dto.ts`'s key list and validator, the UI, and both message
catalogues. `OUTCOME_REASON_CODES` is a closed vocabulary and every entry needs
localised copy.

## 4. Test environment

| | |
|---|---|
| Development database | Neon project `weathered-wave-50814522` ("AISO"), branch `br-square-mountain-az6f82vi`, synthetic seed |
| Application role | `aeo_app` — no DDL; migrations run through `MIGRATE_DATABASE_URL` |
| Integration harness | provisions a disposable Neon branch and re-migrates `public` behind three independent safety proofs (`__tests__/integration/setup.ts`) |
| Blocker | `npm run migrate` denied by the permission classifier; `neonctl` prompts interactively |

Production is a separate concern: Vercel still points at the original production
project and was deliberately left alone. Nothing in this plan touches it.

## 5. Flags

`lib/flags.ts` declares exactly one flag today, `donor_ui_shell`, as a string union
read from `FEATURE_<NAME>`. Phase 1 additions go in that union:

- `owner_home_v1` — slice 5
- `asset_sources_v1` — slice 6
- `recheck_compare_v1` — slice 4

Flags are server-side only and default off, per ADR-011's dark-launch requirement.
They are not a substitute for auth or entitlement.

## 6. Out of scope for Phase 1

Stated so nothing here is later read as promised: broad OAuth, multi-provider
observation, GSC and GA4 connectors, CMS publishing, CRM, and the full agent suite.
The question → observation → citation path (AC-06) is Phase 3. Export-first delivery
stays; no external write connector is added.
