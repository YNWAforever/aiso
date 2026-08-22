# Roll Production onto the Least-Privilege DB Role Design

**Goal:** Finish the least-privilege-role rollout migration `037` started — verify the codebase makes no query `aeo_app` can't satisfy, and hand off a precise runbook for the remaining connection-string cutover, without any agent handling a database password or a production account setting itself.

**Context:** Migration `037_least_privilege_app_role.sql` (merged in [#47](https://github.com/YNWAforever/fimmick-aeo/pull/47)) created `aeo_app`: `BYPASSRLS` (deliberately — seven tables are RLS-enabled with zero policies, and a non-bypass role would return zero rows silently rather than erroring), `SELECT/INSERT/UPDATE/DELETE` on every `public` table plus matching default privileges for future ones, and `SELECT` only on `neon_auth."user"`. It cannot run DDL, create roles, or write anything in `neon_auth`. The role is created `NOLOGIN` on purpose — the migration's own header says a human sets the password out of band so it never enters git.

**What's already true, verified directly rather than assumed:** local dev's `.env.local` `DATABASE_URL` connects as `aeo_app` right now, successfully, against real production data (35 migrations, 8 accounts, 2 clients — `scripts/verify-db-connection.mjs`'s live output). That means the password step already happened and at least one cutover point is done. This directly contradicts a saved project memory claiming dev "still connects as `neondb_owner`" — that memory is stale and gets corrected as part of this work. What's still unverified: Vercel's production `DATABASE_URL`, n8n's stored Postgres credential, and the MCP Postgres server's shell-exported `DATABASE_URL`. None of those were checked by pulling their actual values — a live secret should not pass through an agent's context to determine a fact the human can check locally in one command.

---

## 1. Codebase audit (already performed — findings below, no code changes)

Swept `app/` and `lib/` for anything `aeo_app`'s grants don't cover:

- **No DDL anywhere outside `supabase/migrations/` and `scripts/migrate.ts`.** A repo-wide search for `CREATE|ALTER|DROP (TABLE|ROLE|INDEX|EXTENSION|POLICY)` and `GRANT|REVOKE` in application code turned up nothing — the only "grant"/"revoke" hits are `app/api/admin/clients/route.ts`'s plan-override feature, an unrelated business concept, not SQL.
- **Every `neon_auth` reference is a read, matching the grant exactly.** `app/api/webhooks/neon/route.ts` and `lib/alerts/neon-store.ts` are the only two files touching that schema, and both are `SELECT`/`JOIN` against `neon_auth."user"` — exactly what `037` grants. No write anywhere in application code touches `neon_auth`.
- **`app/api/scan/route.ts`'s `process.env.DATABASE_URL` reference is a presence check, not a second connection** — it doesn't open its own pool with different needs.

**Conclusion, and it's evidence-backed, not inferred: the app's actual query set is fully compatible with `aeo_app`'s restricted grants.** No source change is required for the cutover. Live dev traffic against `aeo_app` already proves this in practice, not just in theory.

## 2. The runbook

New file: `docs/runbooks/roll-out-least-privilege-role.md`, following the shape of the existing `docs/runbooks/rotate-neon-credential.md` (both are "a human executes a sequence this document makes precise and safe" documents). Structure:

- **Baseline**, matching the existing pattern: what `scripts/verify-db-connection.mjs` should report at each of the three unverified touch points before and after.
- **Vercel production `DATABASE_URL`**: how to check the current role without printing the full DSN into a terminal history or a ticket (pull to a local file, grep only the `role` after connecting via the verify script, never `cat` the raw variable) — and how to update it if it's still `neondb_owner`.
- **n8n's stored Postgres credential**: `n8n/configure-credentials.sh` already assumes `DATABASE_URL` is `aeo_app` (confirmed by reading its comments) — the runbook just says when and how to re-run it.
- **MCP Postgres server's shell-exported `DATABASE_URL`**: where that's set (outside this repo — a shell profile or launch config) and how to verify/update it.
- **Rollback**: `neondb_owner`'s connection string is untouched by any of this and keeps working — if a touch point breaks after cutover, reverting that one variable is the fix. No coordinated rollback across all three is needed, since they're independent.
- **Verification**: run `scripts/verify-db-connection.mjs` against each updated target and confirm `role: aeo_app` with matching schema counts to the pre-cutover baseline.

No new tooling is written — `scripts/verify-db-connection.mjs` already reports exactly what's needed (`role`, `db`, and the three schema counts), and it already exists specifically so this kind of check never needs the DSN printed.

## 3. Correct the stale memory

The saved project memory claiming dev/n8n/MCP "still connect as `neondb_owner`" is at least partially wrong — dev is verified otherwise. The memory gets updated to record what's actually been confirmed (dev: done; Vercel/n8n/MCP: unverified, not "still on owner") rather than repeating an unverified claim as settled fact.

---

## What this design deliberately does not do

- **Does not generate, view, or enter any password.** The `037` migration's own header is explicit that this is a human-only step, and it already happened for local dev — nothing in this plan asks an agent to touch a credential.
- **Does not pull or update Vercel's production environment variables directly.** That's an account-settings change; the runbook documents exactly how to do it, and the human executes it.
- **Does not touch n8n or the MCP server's configuration directly** — same reasoning, same "runbook documents it, human executes it" split.
- **Does not change any application code.** The audit's conclusion is that none is needed; if it had found something, that would be a different, larger plan.
- **Does not attempt to determine Vercel/n8n/MCP's current state by pulling live secrets into this session.** The runbook tells the human how to check locally, in a way that never surfaces the DSN in a place an agent (or a ticket, or a terminal scrollback) could read it.
