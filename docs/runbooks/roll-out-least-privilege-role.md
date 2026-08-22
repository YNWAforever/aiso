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
   to the `DATABASE_URL` you just loaded. Prompt for both instead of typing them as
   inline assignments — `VAR=value cmd` puts the literal value on the command line,
   and both bash and zsh record that full line to shell history by default, the
   same exposure this runbook already routes `DATABASE_URL` around:

       read -rs -p "N8N_API_KEY: " N8N_API_KEY && echo
       read -rs -p "OPENROUTER_KEY: " OPENROUTER_KEY && echo
       export N8N_API_KEY OPENROUTER_KEY
       bash n8n/configure-credentials.sh

   The Postgres credential this creates is idempotent -- it's a PATCH to a fixed
   credential ID, so re-running it safely refreshes an already-correct value.
   The OpenRouter credential is NOT idempotent: the script POSTs a new credential
   object on every run and repoints both workflows at it, orphaning whichever one
   it replaces. Only run this if you have a specific reason to believe the
   Postgres credential is stale -- don't run it speculatively "just in case," and
   if you do run it, expect a duplicate OpenRouter credential to appear in the
   n8n UI afterward, which you can delete by hand.

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

1. Find where `DATABASE_URL` is exported for your interactive shell, without ever
   printing the matched line's content — `grep -l` lists only filenames, never the
   line itself, which is the property that actually matters here (an ordinary
   `grep -n` would print the whole line, password included, if the profile embeds
   the connection string directly in the `export` statement):

       grep -l "^export DATABASE_URL" ~/.zshrc ~/.bashrc ~/.zprofile ~/.bash_profile 2>/dev/null

   If nothing is found, the MCP server may be inheriting `DATABASE_URL` some other
   way (a `direnv` `.envrc`, a launcher script, an IDE-level environment setting) —
   locate it before continuing. Once you know which file, open it in your own
   editor to make the edit in Step 2 — editing in an editor is fine, since only you
   see it there; the constraint is specifically about never printing it to a
   terminal, where it can end up in scrollback, a shared session, or a recording.

   The grep above only catches an unindented, single-line `export VAR=...` — it
   misses the two-line style (`DATABASE_URL=...` followed by a separate `export
   DATABASE_URL`) and indented exports inside conditional blocks, both common in
   real dotfiles. A no-print check that a value is set at all, regardless of
   source, is:

       [ -n "$DATABASE_URL" ] && echo "DATABASE_URL is set in this shell (source not shown)"

   On macOS specifically, a GUI-launched terminal or an IDE's integrated terminal
   can inherit `DATABASE_URL` from `launchctl setenv` or a LaunchAgent plist,
   with no shell rc file involved at all -- if the four grep targets above and
   the fallbacks already listed all come up empty, that's worth checking too.

2. Update that export to the same `aeo_app` connection string already in
   `.env.local`'s `DATABASE_URL`. Copy the value directly between the two files
   (e.g. `pbcopy < <(grep '^DATABASE_URL=' .env.local | cut -d= -f2-)` on macOS,
   piped straight into your clipboard, never printed to the terminal) rather than
   retyping it by hand.

   (On Linux, use `xclip -selection clipboard` or `wl-copy` in place of `pbcopy`.)

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
