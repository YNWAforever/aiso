# PR #1 close-out — design

**Status:** Approved 2026-08-31
**Governs:** merging [PR #1](https://github.com/YNWAforever/aiso/pull/1) (Phase 0 close-out)
and handing off `NEON_API_KEY` provisioning.

## Context

Phase 0 of the base plan (`docs/superpowers/plans/2026-08-30-aisogpt-aiso-new-neon-integration.md`)
landed as PR #1: 16 commits, local lint/typecheck/test all green. The stakeholder chose to
close this out before any Phase 1 work: merge the PR now, and hand off the one still-open
item — the `NEON_API_KEY` GitHub Actions secret the new `integration` CI job references but
that isn't provisioned.

## Sequence

1. **Verify CI on GitHub, not just local results.** `gh pr checks` against PR #1 before
   touching the merge button — local runs are the first signal, CI is the backstop
   (`CLAUDE.md`'s own convention), and the actual GitHub Actions environment can differ from
   this local Windows checkout.
2. **Merge via a merge commit, not squash.** `CLAUDE.md`'s Git Conventions: "Recent work
   lands as PR merge commits (no squash)." This PR's 16 commits are each individually
   reviewed (implementer → spec-compliance → code-quality, per task) and worth preserving
   individually in history.
3. **Sync local `main`** to the merged result (`git fetch && git checkout main && git pull`).
4. **Delete the merged remote branch** (`claude/plan-0.4-pillar-snapshot`) — standard
   post-merge cleanup GitHub offers on merge. The local branch is left alone unless asked.
5. **Hand off the secret**, not perform it. Per a hard boundary that holds regardless of
   permission: never type or paste an actual credential/API key value into any command.
   Give the stakeholder the exact command
   (`gh secret set NEON_API_KEY --repo YNWAforever/aiso`) to run themselves, where `gh`
   prompts for the value interactively in their own terminal — nothing sensitive passes
   through this session. This is a follow-up, not a merge blocker.

## Out of scope

Phase 1 (any real Neon resource creation) — not touched here, needs its own separate
authorization when the stakeholder is ready. Actually running the `integration` CI job for
real — blocked on step 5 happening, not something this close-out can verify itself.
