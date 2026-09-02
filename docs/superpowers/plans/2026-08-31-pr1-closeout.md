# PR #1 Close-out Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge [PR #1](https://github.com/YNWAforever/aiso/pull/1) (Phase 0 close-out) into
`main` via a merge commit after confirming CI passed on GitHub, sync local `main`, clean up
the merged branch, and hand the stakeholder the exact command to provision `NEON_API_KEY`
themselves.

**Architecture:** This is an operational task, not a code change — every step is a `gh`/`git`
CLI command against the real, already-pushed `YNWAforever/aiso` repository. No TDD applies;
each step's "verification" is the command's actual output, not a test run.

**Tech Stack:** GitHub CLI (`gh`), git.

---

### Task 1: Merge PR #1 and hand off the secret

**Files:** None — no repository files are created or modified by this task. All actions are
against GitHub's PR/branch/secret state.

- [ ] **Step 1: Confirm PR #1's CI status on GitHub**

Run: `gh pr checks 1 --repo YNWAforever/aiso`

Expected: every listed check shows `pass` (or the run is still `pending` — if pending, wait
and re-run this exact command rather than proceeding; if anything shows `fail`, STOP and do
not merge — investigate the failure instead). Do not proceed to Step 2 until this shows all
green.

- [ ] **Step 2: Merge via a merge commit (not squash)**

Run: `gh pr merge 1 --repo YNWAforever/aiso --merge --delete-branch`

Expected: output confirms the merge (e.g. `✓ Merged pull request YNWAforever/aiso#1`) and
that the remote branch `claude/plan-0.4-pillar-snapshot` was deleted. `--merge` (not
`--squash`) matches `CLAUDE.md`'s Git Conventions: "Recent work lands as PR merge commits (no
squash)." `--delete-branch` removes the branch on GitHub only — your local branch is
untouched by this command.

- [ ] **Step 3: Sync local `main` to the merged result**

Run:
```bash
git fetch origin
git checkout main
git pull origin main
```
Expected: `git log --oneline -1` on `main` now shows the merge commit from Step 2 as HEAD.

- [ ] **Step 4: Verify the local branch's fate and clean up if desired**

Run: `git branch -vv`

Expected: `claude/plan-0.4-pillar-snapshot` shows `[origin/claude/plan-0.4-pillar-snapshot:
gone]` (since Step 2 deleted the remote branch). This local branch is now safe to delete
since its work is merged into `main` — but per the plan's own scope, leave this decision to
whoever runs this plan; deleting a local branch is not automated by this step. If you want it
gone: `git branch -d claude/plan-0.4-pillar-snapshot` (the `-d`, not `-D`, only succeeds if
git confirms the branch's commits are already reachable from `main`, which they will be).

- [ ] **Step 5: Confirm the merged tree is still green on `main`**

Run:
```bash
npm run lint
npm run typecheck
npm test
```
Expected: same clean/green result as it was on the PR branch (lint clean, typecheck clean,
unit suite green, integration skips loudly without `neonctl`) — this is a sanity check that
the merge itself didn't introduce a conflict-driven regression, not a re-run of work already
verified per-task during Phase 0.

- [ ] **Step 6: Hand off the `NEON_API_KEY` secret — do not perform this yourself**

This step is for the human stakeholder to run, not something to execute in an agent session.
Present this exact command to them:

```bash
gh secret set NEON_API_KEY --repo YNWAforever/aiso
```

Running it prompts for the secret value interactively in their own terminal (or they can use
`gh secret set NEON_API_KEY --repo YNWAforever/aiso < path/to/keyfile` if they keep the key in
a local file, or the GitHub web UI under Settings → Secrets and variables → Actions). Once
set, the `integration` job in `.github/workflows/pr-gate.yml` (added in the just-merged PR)
can actually run against a real Neon branch on the next PR or manual `workflow_dispatch`.

**Do not** ask the stakeholder for the key value in chat, and do not type or paste any secret
value into a command yourself — this holds regardless of any permission given, per the
standing rule that credential/API-key entry is never performed by the agent, only by the
human.

- [ ] **Step 7: Report back**

Summarize for the stakeholder: PR #1 merge commit SHA, confirmation `main` is green, whether
the local feature branch was deleted, and the exact `gh secret set` command from Step 6 as
their next action.
