# Rotate the Neon Credential, Least-Privilege First — Design

**Date:** 2026-08-16
**Status:** approved, not yet planned
**Supersedes:** Task 6/7 of `docs/superpowers/plans/2026-08-15-rotate-neon-credential.md`, which are
still pending and whose runbook (`docs/runbooks/rotate-neon-credential.md`) this design replaces.
**Depends on:** migration `037` (introduced `aeo_app`) — applied to production 2026-08-16.

---

## Why now

The `neondb_owner` connection string was disclosed via `neonctl branches create` printing it to
stdout (see `CLAUDE.md`'s Secrets Hygiene section). Rotation was deferred on 2026-08-15 specifically
because a non-owner role would have activated 30 dead RLS policies and silently returned zero rows —
that blocker is gone (`036`, applied 2026-08-16).

Since then, `037` introduced `aeo_app` and the production app has already cut over to it. This
changes the shape of the rotation problem, and the original runbook's consumer inventory is now
stale — it assumes `DATABASE_URL` means `neondb_owner` everywhere, which is no longer true for
production.

### Verified state, 2026-08-16

| Consumer | Currently connects as | Confirmed by |
|---|---|---|
| Vercel production (`fimmick-aeo-oitb`) | `aeo_app` | This session's `037` cutover; live scan against production returned real data |
| Local dev (`.env.local`'s `DATABASE_URL`) | **`neondb_owner`** | Direct `select current_user` against the DSN in `.env.local` |
| `npm run migrate` (`.env.local`'s `MIGRATE_DATABASE_URL`) | `neondb_owner` | By design (`037`; migrations need DDL) |
| MCP Postgres server (`.mcp.json`'s `${DATABASE_URL}`) | Whatever the shell exports — unverified, but user confirms only used for reads/routine DML | `.mcp.json` interpolates the shell's `DATABASE_URL` |
| n8n (3 workflows: `ai-pulse-weekly[-v2].json`, `aiso-scan-webhook.json`) | `neondb_owner` (its stored credential was never updated by the `037` cutover, which only touched Vercel) | Every Postgres node across all three workflow files greped for `create\|alter\|drop\|grant\|revoke\|truncate` — zero matches. All operations are plain `SELECT`/`INSERT`/`UPDATE` against tables `aeo_app` already has blanket grants on. |
| No Vercel project has `MIGRATE_DATABASE_URL` set | — | `vercel env ls production` on both `fimmick-aeo-oitb` and the main account — migrations are exclusively local/human-run, never CI-driven |

One incidental finding, tracked separately and **not part of this design**: `aiso-scan-webhook.json`'s
"Log Error to DB" node inserts into a `scan_errors` table that does not exist in production. Flagged
as its own task; irrelevant to credential rotation.

So: of the five consumers of `DATABASE_URL`/`neondb_owner`-shaped credentials, **four have no
evidenced need for owner-level access** — they'd work identically under `aeo_app`. Only
`MIGRATE_DATABASE_URL` genuinely needs DDL rights.

---

## Goal

Rotate `neondb_owner`'s password, and afterward that credential exists in exactly **one** place:
`.env.local`'s `MIGRATE_DATABASE_URL`, on a human's machine, used only for `npm run migrate`.

## Non-goals

- **Does not touch Vercel.** Production already runs as `aeo_app`; this design doesn't add or change
  anything there.
- **Does not rotate the n8n bearer JWT.** Different credential, different system — see
  `2026-08-15-rotate-neon-credential.md`'s own reasoning for keeping unrelated credential rotations
  separate; this design doesn't reopen that.
- **Does not fix the `scan_errors` table gap.** Tracked as its own task.
- **Does not eliminate `MIGRATE_DATABASE_URL`'s need for owner access.** DDL requires it; this is the
  one legitimate remaining use, not a gap to close.
- **Does not add new verification tooling.** `scripts/verify-db-connection.mjs` already reports
  `current_user` alongside schema counts — sufficient for local dev. The same one-line
  `select current_user` check, run through the MCP Postgres tool itself, covers MCP. n8n's
  correctness is confirmed by its next real run succeeding under the new grant, not by a bespoke
  check.

---

## Architecture: two ordered phases

**Phase 1** moves every consumer that doesn't need DDL onto `aeo_app`, mirroring what production
already did. **Phase 2** rotates `neondb_owner`'s password — by then it only needs updating in one
place.

Every value-setting step in Phase 1 requires **a human**, not an agent: each one means knowing
`aeo_app`'s password, and per this session's established discipline that password was never
captured or seen by an agent — it was set directly by the human via SQL, out of band, in the
`037` cutover. An agent has nothing to copy.

### Phase 1, consumer by consumer

1. **Local dev.** `.env.local`'s `DATABASE_URL` → the same `aeo_app` DSN already live in Vercel. No
   new credential to generate — copy the value that already exists. Verify with
   `node --env-file=.env.local scripts/verify-db-connection.mjs`; expect `role: aeo_app` and the
   same schema counts as before (only the role changes, not the data).

2. **n8n.** Re-run `n8n/configure-credentials.sh` with the `aeo_app` DSN in place of `neondb_owner`'s.
   The script's own comment currently says *"DATABASE_URL is the same Neon connection string the app
   uses (`.env.local`)"* — true again once step 1 lands, but misleading right now while local dev
   and the app disagree; worth a one-line correction in both `configure-credentials.sh` and
   `deploy-workflows.sh` to say explicitly *which* connection string (the least-privilege one, not
   the owner one) so a future reader doesn't assume owner access is needed.

3. **MCP.** Update whatever exports `DATABASE_URL` into the shell for `.mcp.json` — the user's shell
   profile or direnv, outside this repo. Verify with a single query through the MCP tool itself:
   `select current_user` should return `aeo_app`.

### Phase 2: the rotation, with the runbook rewritten for the new consumer inventory

`docs/runbooks/rotate-neon-credential.md` gets rewritten, not patched — its entire "Consumer
inventory" table and half its procedure (Vercel updates, per-deployment verification, cron
verification) describe a world that no longer exists once Phase 1 lands. The new version:

1. Reset the password in the Neon console — same caution as the original: never via `neonctl`,
   which printing a connection string to stdout is the exact failure mode this whole chain started
   from.
2. Update `MIGRATE_DATABASE_URL` in `.env.local`. Nothing else to update — that's the entire point
   of doing Phase 1 first.
3. Verify with `npm run migrate -- --verify` — already proves the new credential authenticates *and*
   holds DDL rights, no bespoke check needed.
4. Confirm the old password is dead (unchanged from the original runbook: attempt a connection with
   the previous DSN, expect authentication failure).

No Vercel step. No per-deployment verification. No cron verification — crons run as `aeo_app` inside
the same deployed app and are unaffected by this rotation.

---

## What this buys, concretely

The original runbook's blast radius — every consumer breaks the moment the password is reset, do
the whole list in one sitting — shrinks from five consumers across three systems (Vercel × N
environments, n8n, MCP, local dev, migrations) to one local environment variable. The *next* time
this password needs rotating, scheduled or forced, it's a five-minute operation instead of a
coordinated multi-system change.

---

## Risks

| Risk | Handling |
|---|---|
| n8n's checked-in workflows don't cover every query it might ever run | Investigated the actual checked-in JSON, not assumed; user independently confirmed no DDL/schema/cross-schema usage in practice |
| Phase 1 and Phase 2 done out of order (rotate first) | Reproduces the original runbook's full blast radius; the ordering is the point of this design, so the plan must sequence it as two clearly separated phases, not present them as independently optional |
| A consumer is missed in Phase 1, silently left on the old owner password, then breaks silently when Phase 2 revokes it | Each Phase 1 step has an explicit verification query (`current_user`); the plan should require all three before Phase 2 begins |
