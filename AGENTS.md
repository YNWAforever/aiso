<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Project rules

Read [`CLAUDE.md`](./CLAUDE.md) before writing any code — it is the architecture document for
this repo, not a Claude-only file. Two things bite immediately:

- Next.js 16 renames `middleware.ts` → **`proxy.ts`** (exporting `proxy`). This repo has
  `proxy.ts` at the root; do not create a `middleware.ts`.
- The project is **mid-migration from Supabase to Neon** and the Supabase project is deleted.
  Never add a new import of `lib/supabase.ts` / `lib/supabase-server.ts` — use `db()` from
  `@/lib/db` (tagged-template queries only), and filter every query by `account_id`.

See [`README.md`](./README.md) for setup, env vars, and commands.
