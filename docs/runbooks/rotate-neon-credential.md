# Runbook: rotate the Neon `neondb_owner` password

**When to run this:** the connection string has been disclosed — pasted into a
transcript, a log, a ticket, a screenshot — or on a scheduled rotation.

**Who runs it:** a human with Neon console access and Vercel project access.
An agent must not perform any step that reads or types the password.

**Blast radius:** every consumer below breaks the moment the old password is
revoked, and stays broken until updated. Do the whole list in one sitting.

## Consumer inventory

| Consumer | Where | How it is updated |
|---|---|---|
| Vercel deployment | `DATABASE_URL` env var, **per project and per environment** (production / preview / development) | Vercel dashboard, or `vercel env` |
| Local development | `.env.local` at the repo root | Edit the file |
| MCP servers | `.mcp.json` interpolates `${DATABASE_URL}` from the shell | Whatever exports it (shell profile / direnv) |
| n8n | A stored **Postgres credential** built from this DSN by `n8n/configure-credentials.sh` | Re-run that script with the new `DATABASE_URL` |
| Integration tests | Read `DATABASE_URL` at run time | Inherited from `.env.local`; nothing separate |

> There may be **more than one Vercel project** bound to this database. One is
> `fimmick-aeo-oitb`; the project backing the live domain has historically been
> under a different login. Enumerate projects before you start, and update every
> one — a project you forget is a production outage you find out about later.

## Procedure

1. **Record the pre-rotation baseline.**

       node --env-file=.env.local scripts/verify-db-connection.mjs

   Save the output. The schema counts must be identical afterwards; only the
   credential is changing.

2. **Enumerate every Vercel project bound to this database**, and for each, every
   environment that defines `DATABASE_URL`. Write the list down before changing
   anything.

3. **Reset the password** in the Neon console: project `AEOGEO`
   (`red-firefly-93523049`), branch `production`, role `neondb_owner` → reset
   password. Copy the new connection string into your password manager first, not
   into a terminal, a chat, or a file you will forget.

   Do not use `neonctl` for this step. Use the console — `neonctl` prints
   connection URIs to stdout, which is the failure mode that caused this
   rotation.

4. **Update every consumer from the inventory**, in this order so the window
   where things are broken is shortest:
   - Vercel env vars for every project and environment, then redeploy each.
   - `.env.local`.
   - Whatever exports `DATABASE_URL` into your shell for `.mcp.json`.
   - Re-run `n8n/configure-credentials.sh` with the new `DATABASE_URL`.

5. **Verify locally.**

       node --env-file=.env.local scripts/verify-db-connection.mjs

   Expect `connected: yes` and the same schema counts as step 1.

6. **Verify each deployment** by exercising a route that touches the database and
   confirming a 200 rather than a 500.

7. **Verify both crons still authenticate and run.** They are the consumers least
   likely to be noticed if broken, because they fire weekly:
   `/api/cron/pulse` (Mondays 04:17 UTC) and `/api/cron/evaluate-alerts`
   (Mondays 07:47 UTC). Either wait for the next Monday and confirm a 200 in the
   deployment logs, or trigger each once manually with its documented auth shape.

8. **Confirm the old password is dead.** Attempt a connection with the previous
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
