# Acceptance matrix refresh

## What this closes

`docs/implementation/aiso-owner-platform/04-ACCEPTANCE-MATRIX.md` was last written
against the state on 2026-09-10/11. Six PRs have merged since (#44–#49), and every
one of them touched a row the matrix currently lists as **PARTIAL**: AC-01 (slice-10
activation journey), AC-03 (claim-replay), AC-06 (registered assets + multi-source),
AC-12 (tenancy inventory), and AC-14 (the live approval proof, merged today). The
document no longer describes the repository it's checked into for five of its seven
open rows, and picking genuinely "next phase" work off an inaccurate board risks
either re-solving something already closed or missing that something regressed.

This is a documentation-only refresh, not new product work. Nothing here changes
behaviour; it brings the matrix's claims back into agreement with what the merged
code and tests actually prove today.

## Decisions taken

1. **Verify against current code and tests, not PR titles or memory.** The matrix's
   own stated rule — "Nothing here claims a capability that was not exercised" and
   "No row is marked PASS on the strength of a build succeeding" — applies to writing
   the refresh, not just to the original document. Each of the 5 rows gets rewritten
   only after reading the actual current migrations/modules/tests it depends on.
2. **Scope is the 5 rows the 6 merged PRs actually touched**, not all 15. The other
   10 rows (2 still-PARTIAL: AC-11, AC-15; 8 PASS: AC-02, AC-04, AC-05, AC-07–AC-10,
   AC-13) weren't touched by any of #44–#49 and stay as last written.
3. **Preserve the document's existing voice and rigor**, not just its structure:
   specific file:line citations, explicit test counts, the PARTIAL-vs-PASS
   distinction stated in evidence rather than asserted, and the document's own
   habit of naming exactly what would need to be true for a row to move to PASS.
   A rewritten row that reads like a summary rather than like the rest of this
   document would be a regression in the thing being fixed.

## Scope

**In scope — rewrite these 5 rows' Status and Evidence cells:**
- **AC-01** — check what PR #46 (slice-10 activation journey) closed against the
  row's current "still partial: none of this has been exercised against a database"
  language.
- **AC-03** — check what PR #44 (claim-replay) closed against the row's named gaps
  ("single-use replay consumption... never persisted", "no domain-ownership
  verification").
- **AC-06** — check what PR #48 (multi-source, migration `051`'s task half) closed
  against the row's own stated blocker ("`051` is authored and has run only against
  disposable integration-test branches, never a persistent database").
- **AC-12** — check what PR #45 (tenancy inventory) added beyond what the row
  already describes.
- **AC-14** — rewrite to reflect PR #49: the two verbs are now automated (a second
  captured-session fixture, two real E2E tests proving approve and request-changes
  through the actual UI, a version-selection bug found and fixed along the way),
  gated behind a runbook-documented two-pass human procedure. The row stays
  PARTIAL — not PASS — because the live run and the resulting acceptance-matrix
  update are still a human step nothing automated has performed. This replaces the
  row's current framing ("that is not merely a human step, it is not reachable
  through the product at all"), which is no longer true.

**Also in scope:**
- The "as of" date on line 3 (currently 2026-09-10).
- The tally table (§2, currently 8 PASS / 7 PARTIAL) if any row's status changes.
- The closing paragraph after the tally (currently still describes AC-14 as of
  2026-09-11 as the reason no row is PASS/BLOCKED) — update or remove whatever no
  longer matches.
- §3 ("What was blocking, and what is left") if a currently-open item there was
  closed by one of the 6 PRs.

**Out of scope:**
- The other 10 rows.
- §4 (agent-safety evaluation), §5 (the exact-target-suites CI wrapper), §6 (the
  runtime-probe findings) — none of these were touched by #44–#49.
- Any code change, migration, or new test.
- Verifying migrations against the production database (the matrix already
  distinguishes the AISO development database from production; that distinction
  isn't part of this refresh).

## Method

For each of the 5 rows: read the merge commit(s) for its PR(s), then independently
read the current state of the code, tests, and (where relevant) migrations it
depends on — not the PR's own description — and rewrite the row's Status and
Evidence to match. Where a row's claim can only be confirmed by something already
proven earlier in this session (e.g. AC-14, done in this same conversation), that
evidence is still restated in the document's own citation style rather than
copy-pasted from a PR body or a chat summary.

## Verification plan

This is a documentation change, so "testing" means: after rewriting, re-read the
whole document once more with fresh eyes and confirm (a) every claim in a touched
row cites something checkable (a file, a test name, a migration number), (b) the
tally table and the closing paragraph agree with the 5 rows as rewritten, (c) no
row claims more than what was actually re-verified, and (d) the document's
markdown structure (table formatting, section boundaries) is intact — the same
self-review discipline `writing-plans` and `brainstorming` already require for
their own output, applied here to prose instead of code.
