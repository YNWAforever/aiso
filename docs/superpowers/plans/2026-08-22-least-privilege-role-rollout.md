# Roll Production onto the Least-Privilege DB Role Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write a precise, self-contained runbook for the two genuinely unverified connection-string consumers of the `aeo_app` least-privilege role — n8n's stored Postgres credential and the MCP Postgres server's shell-exported `DATABASE_URL` — so a human can execute the remaining cutover safely, with no agent handling a password or a credential store.

**Architecture:** A single new markdown file, `docs/runbooks/roll-out-least-privilege-role.md`, following the exact shape of the existing `docs/runbooks/rotate-neon-credential.md`. This is documentation only — no application code changes, because the design's codebase audit already established the app's query set is fully compatible with `aeo_app`'s grants, and Vercel production is already cut over and verified per [PR #47](https://github.com/YNWAforever/fimmick-aeo/pull/47) (out of scope here entirely — re-touching it would be redundant work against a settled fact).

**Tech Stack:** Documentation only. Markdown, referencing existing scripts (`scripts/verify-db-connection.mjs`, `n8n/configure-credentials.sh`) without modifying them.

**Design doc:** `docs/superpowers/specs/2026-08-22-least-privilege-rollout-design.md` — read it first for the full context on *why* this is scoped the way it is, including the mid-design correction that removed Vercel from scope.

---

## Read this first: the two consumers, and what's already confirmed about each

**n8n.** `n8n/configure-credentials.sh` already documents, in its own header comment, that `DATABASE_URL` should be "the app's least-privilege connection string (aeo_app, migration 037) — the same one in `.env.local`'s `DATABASE_URL`, NOT `MIGRATE_DATABASE_URL`," and notes "n8n's queries here are plain SELECT/INSERT/UPDATE; nothing here needs DDL." That's a documentation update, not proof the script has actually been *run* since `037`. The n8n instance is `https://anfield-n8n.zeabur.app`.

**MCP.** `.mcp.json` (git-tracked, at the repo root) configures the `neon` MCP server as:

```json
"neon": {
  "type": "stdio",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-postgres@0.6.2", "${DATABASE_URL}"]
}
```

`${DATABASE_URL}` is substituted from whatever the *shell environment* has when the MCP client (Claude Code) starts — not from `.env.local` directly, since nothing in this invocation chain does an explicit `--env-file` load. That's a different, and separately unverified, value from `.env.local`'s, even though they're both named `DATABASE_URL`. This is exactly why "the MCP server's shell-exported `DATABASE_URL`" is worth calling out as its own item rather than assuming it inherits `.env.local`'s already-confirmed `aeo_app` connection.

**Neither consumer's actual current value should be read by an agent.** `echo $DATABASE_URL`, printing `.mcp.json`'s resolved value, or pulling n8n's stored credential via its API would all put a live database password into this session's transcript — precisely the class of leak `docs/runbooks/rotate-neon-credential.md`'s own "Prevention" section exists to avoid. The runbook tells the human how to check locally, using the same no-DSN-printed pattern `scripts/verify-db-connection.mjs` already provides.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `docs/runbooks/roll-out-least-privilege-role.md` | Precise, human-executed procedure for cutting n8n and MCP over to `aeo_app`, verifying each, and rolling back if needed | Create |

**Commands** (from the repo root):

```bash
npm run lint
```

```bash
grep -n "neondb_owner\|aeo_app" docs/runbooks/roll-out-least-privilege-role.md
```

There is no test suite for markdown content. Verification for this plan means: the file exists, reads coherently end to end, cites real file paths and commands that actually exist in the repo, and `npm run lint`/`npm run typecheck` stay clean (they should be entirely unaffected by an added `.md` file, and running them confirms nothing else in the working tree was accidentally touched).

Baseline before this plan: **147 files / 1621 tests** pass (this branch is off `main` post-#51, before the `restore-notifications` PR's later state — record the actual count you see, since multiple other branches have landed on `main` this session and the exact number may have moved); lint and typecheck are clean.

---

### Task 1: Write the runbook

**Files:**
- Create: `docs/runbooks/roll-out-least-privilege-role.md`

- [ ] **Step 1: Confirm the reference files this runbook cites still match reality**

Before writing, verify each of these three claims against the actual current files — the design doc verified them once, but re-confirm here since this task runs in a fresh context with no memory of that verification:

```bash
grep -n "DATABASE_URL is the app's least-privilege connection string" n8n/configure-credentials.sh
grep -n "DATABASE_URL" .mcp.json
grep -n "role    :" scripts/verify-db-connection.mjs
```

Expected: the first two greps each return one match confirming the claims in this plan's "Read this first" section; the third confirms `scripts/verify-db-connection.mjs` prints a `role` line (the mechanism the runbook's verification steps rely on). If any of these have changed or are missing, STOP and report the discrepancy — do not write a runbook that cites something that no longer matches the code.

- [ ] **Step 2: Write the runbook**

Create `docs/runbooks/roll-out-least-privilege-role.md` with exactly this content:

````markdown
# Runbook: cut n8n and MCP over to the least-privilege `aeo_app` role

**When to run this:** any time after migration `037` is applied and `aeo_app` has a
password set (both already true in production — see
`docs/runbooks/rotate-neon-credential.md`'s precondition note). This runbook only
covers the two connection-string consumers that PR #47 did not verify: n8n and the
MCP Postgres server. Everything else — Vercel production, local dev — is already
cut over and verified; do not repeat that work here.

**Who runs it:** a human. An agent must not read, type, or print any value of
`DATABASE_URL` while executing this — every step below is written so the actual
connection string never needs to appear in a terminal history, a chat transcript,
or a ticket.

**Precondition:** local dev's `.env.local` already has `DATABASE_URL` set to the
`aeo_app` connection string (verified 2026-08-22). Both consumers below use that
same value — you are not generating a new credential, you're pointing two more
things at one that already exists and already works.

## Consumer 1: n8n's stored Postgres credential

`n8n/configure-credentials.sh` builds n8n's stored credential from whatever
`DATABASE_URL` is in your shell when you run it. Its own header comment already
says this should be the `aeo_app` connection string — the question this step
answers is whether it's actually been run since that comment was written, not
whether the script is correct.

1. Load `.env.local` into your shell without printing it:

       set -a; . ./.env.local; set +a

2. Re-run the credential configurator. It needs `N8N_API_KEY` (from
   `https://anfield-n8n.zeabur.app/settings/api`) and `OPENROUTER_KEY` in addition
   to the `DATABASE_URL` you just loaded:

       N8N_API_KEY="<n8n api key>" OPENROUTER_KEY="<openrouter key>" \
         bash n8n/configure-credentials.sh

   This is idempotent — re-running it against an already-correct credential is a
   no-op, so there's no harm in running it even if you're not sure it's needed.

3. In the n8n UI (`https://anfield-n8n.zeabur.app`), open any workflow using the
   "Neon Postgres" credential and execute a single read-only node manually (a
   `SELECT 1`-style test query, or the workflow's own first read step). Confirm it
   succeeds. n8n's credential test button, if the Postgres credential type
   exposes one, is sufficient on its own — you don't need to run a full workflow.

## Consumer 2: the MCP Postgres server's shell-exported `DATABASE_URL`

`.mcp.json` configures the `neon` MCP server as
`npx -y @modelcontextprotocol/server-postgres@0.6.2 "${DATABASE_URL}"` — that
variable is substituted from your shell environment at the moment the MCP client
(Claude Code) starts, **not** from `.env.local` automatically. If your shell
profile (`.zshrc`, `.bashrc`, or equivalent) exports `DATABASE_URL` separately
from `.env.local`, that export is what the MCP server actually uses, and it may
still be the old `neondb_owner` value.

1. Find where `DATABASE_URL` is exported for your interactive shell:

       grep -rn "export DATABASE_URL" ~/.zshrc ~/.bashrc ~/.zprofile ~/.bash_profile 2>/dev/null

   If nothing is found, the MCP server may be inheriting `DATABASE_URL` some other
   way (a `direnv` `.envrc`, a launcher script, an IDE-level environment setting) —
   locate it before continuing. Do not print the matched line's value; the grep
   above only shows *which file* sets it, not what it's set to, which is enough to
   know where to edit.

2. Update that export to the same `aeo_app` connection string already in
   `.env.local`'s `DATABASE_URL`. Copy the value directly between the two files
   (e.g. `pbcopy < <(grep '^DATABASE_URL=' .env.local | cut -d= -f2-)` on macOS,
   piped straight into your clipboard, never printed to the terminal) rather than
   retyping it by hand.

3. Restart Claude Code (or whatever process launches the MCP client) so it
   re-reads the updated shell environment — MCP servers are spawned once at
   startup and won't pick up an environment change made after the fact.

4. Verify: ask the connected `neon` MCP server to run a trivial read (e.g. list
   tables, or `select current_user`) and confirm the result shows `aeo_app`, not
   `neondb_owner`, as the connecting role.

## Verification

Run this against both consumers' effective environment once each is updated —
it never prints the DSN, only the role and schema counts:

    node --env-file=.env.local scripts/verify-db-connection.mjs

Expect `role: aeo_app` and schema counts matching the current baseline (at time of
writing: `migrations: '35', accounts: '8', clients: '2'` — counts will have grown
since; the point is that they're non-zero and plausible, not that they match this
exact snapshot).

For the MCP server specifically, `scripts/verify-db-connection.mjs` doesn't apply
directly (it's a standalone script, not something the MCP server runs) — the
in-session check in Consumer 2, Step 4 is the equivalent verification for that
consumer.

## Rollback

Both consumers are independent of each other and of Vercel/dev. If either breaks
after cutover, reverting *that one* value back to the `neondb_owner` connection
string is the fix — no coordinated rollback across consumers is needed, and doing
so does not affect Vercel production or local dev, which are already on `aeo_app`
and stay that way regardless of what n8n or MCP are doing.

## Still outstanding, not covered by this runbook

[PR #47](https://github.com/YNWAforever/fimmick-aeo/pull/47)'s own test-plan
checklist has one unchecked item: *"Full manual verification still owed by a
human with dashboard access: an authenticated dashboard load, a client report
open (exercises `BYPASSRLS` against a default-deny table), a Stripe webhook
replay, and a real signup (exercises the `neon_auth` grant)."* That's
already-tracked work belonging to that PR, not this runbook — noted here only so
a reader who finishes this doesn't mistake the least-privilege rollout as fully
closed out.
````

- [ ] **Step 3: Verify the runbook's own citations are internally accurate**

Run:

```bash
grep -n "n8n/configure-credentials.sh\|scripts/verify-db-connection.mjs\|\.mcp\.json" docs/runbooks/roll-out-least-privilege-role.md
```

Expected: each citation matches a file that genuinely exists at the path named. Confirm each with `ls <path>`.

- [ ] **Step 4: Run lint and typecheck to confirm nothing else was touched**

```bash
npm run lint
npm run typecheck
```

Expected: both clean (0 errors/warnings; exit 0) — a new markdown file cannot affect either, so a clean pass here also confirms no other file was accidentally modified. Note: `npm test` does NOT work in this worktree (its `node_modules` is empty); this task needs no test run in any case, since it changes no code.

- [ ] **Step 5: Commit**

```bash
git add docs/runbooks/roll-out-least-privilege-role.md
git commit -m "docs: runbook for cutting n8n and MCP over to the least-privilege role"
```

---

## What this plan deliberately does not do

- **Does not touch Vercel.** Already cut over and verified per PR #47 — see the design doc for the evidence. Re-checking it here would be redundant, not thorough.
- **Does not run any step of the runbook itself.** Writing the runbook is this plan's entire deliverable; executing it is the human step the runbook exists to make safe.
- **Does not read, print, or otherwise handle any live `DATABASE_URL` value**, in any step, including verification. Every check in this plan and the runbook it produces relies on `scripts/verify-db-connection.mjs`'s existing no-DSN-printed design, or on structural checks (does a file exist, does a grep match) that never touch a secret.
- **Does not correct the project memory file.** That's outside the git repository this plan operates on, has no test or lint to verify it, and is a small enough edit that it belongs as a direct action alongside this plan's execution rather than a formal task within it.
- **Does not perform PR #47's outstanding manual-QA checklist item.** Surfaced in the runbook's closing section so it isn't lost, not duplicated as new work here.
