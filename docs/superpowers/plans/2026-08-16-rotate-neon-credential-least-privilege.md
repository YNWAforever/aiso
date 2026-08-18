# Rotate the Neon Credential, Least-Privilege First — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rotate the `neondb_owner` password so that, afterward, it exists in exactly one place —
`.env.local`'s `MIGRATE_DATABASE_URL`, on a human's machine, used only for `npm run migrate`.

**Architecture:** Two ordered phases. Phase 1 (Tasks 3) moves every consumer that doesn't need DDL
— local dev, n8n, MCP — onto `aeo_app`, mirroring what production already did in migration `037`.
Phase 2 (Task 4) rotates the password using a rewritten runbook that reflects the shrunk consumer
inventory. Tasks 1–2 prepare the ground (fix stale docs, rewrite the runbook) before either phase
runs; Task 5 records the new state once rotation is confirmed done.

**Tech Stack:** Neon Postgres, `@neondatabase/serverless`, bash (`n8n/*.sh`), Markdown runbooks.

---

## Read this before you start

**The design document is `docs/superpowers/specs/2026-08-16-rotate-neon-credential-least-privilege-design.md`.** Read it — it has the full verified consumer inventory this plan acts on.

**No agent may see or type `aeo_app`'s or `neondb_owner`'s password, ever, in any task in this
plan.** Every task that sets a real credential value is marked HUMAN ONLY. An agent's job is
docs, scripts that *read* an env var without printing it, and verification queries that report
`current_user` — never a literal password.

**Tasks 3 and 4 are strictly ordered.** Task 4 (the rotation) must not start until Task 3 (moving
every non-DDL consumer to `aeo_app`) is confirmed complete. Rotating first reproduces the exact
blast radius this plan exists to avoid — every consumer still on the old password breaks the
moment it's reset. If asked to skip ahead, refuse and point back to this paragraph.

**Never paste a connection string into a shell command.** The `@neondatabase/serverless` driver
echoes the full URL including the password in its error messages. Pipe through
`2>&1 | grep -v "postgresql://"` when scripting against it, per `CLAUDE.md`'s Secrets Hygiene
section.

---

## Task 1: Correct the stale n8n script comments

**Files:**
- Modify: `n8n/configure-credentials.sh:9`
- Modify: `n8n/deploy-workflows.sh:6`

Both scripts currently say `DATABASE_URL` "is the same Neon connection string the app uses
(`.env.local`)" — true again once Task 3 lands, but misleading right now (local dev is still on
`neondb_owner`; the app is on `aeo_app`), and worth being explicit about *which* string even after
Task 3, so a future reader doesn't assume owner access is needed.

- [ ] **Step 1: Edit `n8n/configure-credentials.sh`**

Find:

```bash
# DATABASE_URL is the same Neon connection string the app uses (.env.local).
```

Replace with:

```bash
# DATABASE_URL is the app's least-privilege connection string (aeo_app, migration
# 037) — the same one in .env.local's DATABASE_URL, NOT MIGRATE_DATABASE_URL.
# n8n's queries here are plain SELECT/INSERT/UPDATE; nothing here needs DDL.
```

- [ ] **Step 2: Edit `n8n/deploy-workflows.sh`**

Find:

```bash
# DATABASE_URL is the same Neon connection string the app uses (.env.local).
```

Replace with:

```bash
# DATABASE_URL is the app's least-privilege connection string (aeo_app, migration
# 037) — the same one in .env.local's DATABASE_URL, NOT MIGRATE_DATABASE_URL.
```

- [ ] **Step 3: Verify the edits landed correctly**

Run: `grep -n "DATABASE_URL is the app's least-privilege" n8n/configure-credentials.sh n8n/deploy-workflows.sh`

Expected: one match per file.

Run: `grep -rn "DATABASE_URL is the same Neon connection string the app uses" n8n/`

Expected: no output — the old, now-inaccurate wording is gone from both files.

- [ ] **Step 4: Lint**

Run: `npm run lint`

Expected: exit 0, zero warnings. (Shell scripts aren't linted by this command, but this confirms the edit didn't accidentally touch anything ESLint does cover.)

- [ ] **Step 5: Commit**

```bash
git add n8n/configure-credentials.sh n8n/deploy-workflows.sh
git commit -m "docs(n8n): clarify DATABASE_URL means the app role, not the owner"
```

---

## Task 2: Rewrite the rotation runbook

**Files:**
- Modify: `docs/runbooks/rotate-neon-credential.md` (full rewrite, not a patch — the current
  version's consumer inventory and half its procedure describe a world that no longer exists once
  Task 3 lands)

- [ ] **Step 1: Replace the entire file**

Overwrite `docs/runbooks/rotate-neon-credential.md` with:

```markdown
# Runbook: rotate the Neon `neondb_owner` password

**When to run this:** the connection string has been disclosed — pasted into a
transcript, a log, a ticket, a screenshot — or on a scheduled rotation.

**Who runs it:** a human with Neon console access. An agent must not perform any
step that reads or types the password.

**Precondition — read this first:** this runbook assumes every consumer that
doesn't need DDL has already moved to `aeo_app` (migration `037`). If you're not
sure that's true, stop and run the consumer-migration steps in
`docs/superpowers/plans/2026-08-16-rotate-neon-credential-least-privilege.md`
(Task 3) first. Rotating before that reproduces the old, much larger blast
radius — every consumer still on the old password breaks the moment it's reset.

**Blast radius, once the precondition holds:** exactly one place —
`MIGRATE_DATABASE_URL` in `.env.local`, used only by `npm run migrate`. Nothing
else references `neondb_owner`. In particular:

- **Vercel is not touched.** Production connects as `aeo_app`, not
  `neondb_owner`, and always has since `037`'s cutover.
- **No deployment needs redeploying**, and no per-deployment verification is
  needed as part of this runbook.
- **Crons are not affected.** `/api/cron/pulse` and `/api/cron/evaluate-alerts`
  run inside the same deployed app, as `aeo_app`.

## Procedure

1. **Reset the password** in the Neon console: project `AEOGEO`
   (`red-firefly-93523049`), branch `production`, role `neondb_owner` → reset
   password. Copy the new connection string into your password manager first, not
   into a terminal, a chat, or a file you will forget.

   Do not use `neonctl` for this step. Use the console — `neonctl` prints
   connection URIs to stdout, which is the failure mode that caused the original
   leak this rotation exists to remedy.

2. **Update `MIGRATE_DATABASE_URL`** in `.env.local`. This is the only consumer.

3. **Verify.**

       node --env-file=.env.local scripts/migrate.ts --verify

   Expect every migration to report `recorded`. This single command proves the
   new credential both authenticates and holds DDL rights — no separate check is
   needed.

4. **Confirm the old password is dead.** Attempt a connection with the previous
   DSN and expect authentication failure. If it still works, the reset did not
   take effect and you are not rotated.

## Prevention

Use `scripts/neon` instead of bare `neonctl`. It pipes stdout and stderr through
`scripts/redact.mjs`, so a printed connection URI comes out as
`postgresql://neondb_owner:***@host…`.

Two neonctl behaviours to keep in mind, neither of which the wrapper can fix:

- `neonctl branches create` prints the full connection URI, password included,
  to stdout. Branch roles are inherited, so that is the parent's password.
- `neonctl connection-string --branch-id <id>` returns the **parent's** endpoint,
  not the branch's. A DSN obtained that way can point at production while you
  believe you are on a throwaway branch. Always assert the host before writing.
```

- [ ] **Step 2: Verify the old, stale content is gone**

Run: `grep -n "Vercel deployment\|per project and per environment\|Verify each deployment\|both crons still authenticate" docs/runbooks/rotate-neon-credential.md`

Expected: no output — the rewritten runbook contains none of the old per-deployment/cron
verification language, since those consumers no longer touch this credential.

- [ ] **Step 3: Commit**

```bash
git add docs/runbooks/rotate-neon-credential.md
git commit -m "docs: rewrite the rotation runbook for the aeo_app consumer inventory"
```

---

## Task 3: Move local dev, n8n, and MCP to `aeo_app` (HUMAN ONLY — agents stop here)

**Files:** none. This task sets real credential values, which no agent may see or type.

> **Agents: do not perform this task.** Every step below requires knowing `aeo_app`'s password,
> which was set directly by a human via SQL during the `037` cutover and was never seen by an
> agent. Hand this plan to the human and wait for confirmation of all three steps before
> proceeding to Task 4. Do not ask the user to paste any DSN to you.

- [ ] **Step 1: Move local dev**

In `.env.local`, set `DATABASE_URL` to the same `aeo_app` connection string already live in
Vercel's production `DATABASE_URL` for the `fimmick-aeo-oitb` project. No new credential to
generate — copy the value that already exists.

Verify:

```bash
node --env-file=.env.local scripts/verify-db-connection.mjs
```

Expected: `connected: yes`, `server: { role: 'aeo_app', ... }`, and the same `migrations`,
`accounts`, `clients` counts as before this change (only the role changes, not the data).

- [ ] **Step 2: Move n8n**

Re-run `n8n/configure-credentials.sh`, passing the same `aeo_app` DSN as `DATABASE_URL` (the
script's own comment, corrected in Task 1, now says exactly which string this must be):

```bash
N8N_API_KEY="<your n8n API key>" \
DATABASE_URL="<the aeo_app connection string>" \
OPENROUTER_KEY="<your existing OpenRouter key>" \
bash n8n/configure-credentials.sh
```

Load `DATABASE_URL` from `.env.local` rather than typing it, per the script's own guidance
(`set -a; . ./.env.local; set +a`), so it's never in your shell history.

Verify by triggering one of the three n8n workflows (`ai-pulse-weekly`, `ai-pulse-weekly-v2`, or
`aiso-scan-webhook`) and confirming it completes without a permission error. All three workflows'
Postgres nodes are plain `SELECT`/`INSERT`/`UPDATE` (verified in the design doc's investigation —
no `CREATE`/`ALTER`/`DROP`/`GRANT`/`REVOKE`/`TRUNCATE` anywhere in any of the three workflow
files), so this should succeed identically to before.

- [ ] **Step 3: Move MCP**

Update whatever exports `DATABASE_URL` into your shell for `.mcp.json` — your shell profile or
direnv configuration, outside this repo — to the `aeo_app` connection string.

Verify with a single query through the MCP Postgres tool itself: `select current_user`. Expected:
`aeo_app`.

- [ ] **Step 4: Confirm all three before proceeding**

Do not move to Task 4 until all three verifications above have actually been run and passed —
not assumed. A consumer silently left on `neondb_owner` here breaks the moment Task 4 revokes the
old password, and it breaks silently, at whatever moment that consumer is next used.

---

## Task 4: Rotate the password (HUMAN ONLY — agents stop here)

**Files:** none. This task changes a live credential, not code.

> **Agents: do not perform this task.** Hand the human
> `docs/runbooks/rotate-neon-credential.md` (rewritten in Task 2) and wait for them to confirm
> completion before starting Task 5. Do not offer to run any part of it, and do not ask the user
> to paste the new connection string to you — you do not need it and must not have it.

- [ ] **Step 1: Confirm Task 3 is fully done**

Do not proceed if any of Task 3's three verification steps were skipped or failed.

- [ ] **Step 2: Human runs the runbook**

Follow every step of `docs/runbooks/rotate-neon-credential.md`, including the step-4 check that
the old password no longer authenticates.

- [ ] **Step 3: Human confirms completion**

Confirm to the agent (or record here) that: the password is reset, `MIGRATE_DATABASE_URL` in
`.env.local` is updated, `npm run migrate -- --verify` reports every migration `recorded` under
the new credential, and the old password is confirmed dead.

---

## Task 5: Record the new state (only after Task 4 is confirmed complete)

**Files:**
- Modify: `CLAUDE.md` (the Secrets Hygiene section)

Run this only after the human confirms Task 4 is complete.

- [ ] **Step 1: Update the Secrets Hygiene section**

In `CLAUDE.md`, find this bullet:

```markdown
- **`.mcp.json` is git-tracked. It no longer contains a literal token** — it interpolates
  `${N8N_MCP_TOKEN}` and `${DATABASE_URL}` — but the old n8n bearer JWT is still reachable in
  history at `bcbe9dc`, and it carries no `exp` claim, so it never self-expires. **Rotating it
  in n8n is still owed**; removing it from HEAD achieved nothing on its own.
```

Add this bullet immediately after it:

```markdown
- **`neondb_owner`'s password was rotated on 2026-08-16 and now lives in exactly one place:
  `MIGRATE_DATABASE_URL` in `.env.local`.** Local dev, n8n, and the MCP Postgres server all
  connect as `aeo_app` instead — same role production has used since `037`. None of them showed
  any evidence of needing DDL (see `docs/superpowers/specs/2026-08-16-rotate-neon-credential-least-privilege-design.md`
  for the investigation). The next rotation of this password is a one-variable change, not a
  five-consumer one.
```

- [ ] **Step 2: Verify nothing else in the repo still claims the old, wider blast radius**

Run: `grep -rn "every Vercel project\|per project and per environment" CLAUDE.md docs/runbooks/`

Expected: no output.

- [ ] **Step 3: Run the full suite, lint and typecheck**

Run: `npm run test:unit`

Expected: PASS, every file, unchanged count — this task only edits Markdown.

Run: `npm run lint`

Expected: exit 0, zero warnings.

Run: `npm run typecheck`

Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: record the neondb_owner rotation and its shrunk blast radius"
```

---

## What this plan deliberately does not do

- **It does not rotate the n8n bearer JWT** still reachable in history at `bcbe9dc`, which has no
  `exp` claim and never self-expires. Different credential, different system — see
  `2026-08-15-rotate-neon-credential.md`'s own reasoning for keeping unrelated credential
  rotations separate.
- **It does not fix the `scan_errors` table gap** found while auditing n8n's workflows (an insert
  into a table that doesn't exist in production). Tracked as its own task, unrelated to
  credentials.
- **It does not touch Vercel.** Production has run as `aeo_app` since `037`; nothing here changes
  that.
- **It does not add new verification tooling.** `scripts/verify-db-connection.mjs` already
  reports `current_user`; that and a one-line `select current_user` through the MCP tool are
  sufficient.
