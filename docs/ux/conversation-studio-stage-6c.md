# Conversation Studio Stage 6c — Persistent private threads

- Brief: `/workspace/aiso-brief-stage-6c-private-threads.md`
- Design: `docs/superpowers/specs/2026-11-01-aiso-studio-stage-6-full-design.md` §4 Wave 2 / 6c
- ClickUp: [z8qgvca4ph](https://app.clickup.com/t/z8qgvca4ph)
- Base: `e70a06509d1606802c13654d86cafc94831fd37c` (`origin/main`, Stage 6b squash)
- Branch: `codex/conversation-studio-stage-6c`

## What ships

「最近討論 · 私人」is now saved in Neon instead of React memory. The existing
Studio sidebar, home continue list and `/studio/threads` page hydrate from the
server on mount, lazily read turns when a thread opens, and keep the existing
product surface. Composer drafts and the selected template remain client-only.

There is no thread sharing in 6c. Visibility is the creator principal only:
`(account_id, client_id, profile_id)`. Other profiles in the same account,
other brands and other accounts are not listed and receive `404` on read/write.

Failed writes are honest: the thread badge stays `Not saved`/`未儲存`, and the
discussion shows `未能儲存此變更，重新整理後會消失。`. Failed reads show the
existing `readUnavailable` message. Nothing is labelled as saved before the
server confirms it. Persisted `reply`/`live` values are display snapshots only;
they are never used as evidence or fingerprints for the 6b work-item save.

## Schema (migration 081)

`supabase/migrations/081_studio_private_threads.sql`

### `studio_threads`

| Column | Type / constraint |
| --- | --- |
| `id` | `uuid primary key default gen_random_uuid()` |
| `account_id` | `uuid not null references accounts(id) on delete cascade` |
| `client_id` | `uuid not null` |
| `profile_id` | `uuid not null` |
| `kind` | `text check (kind in ('research','brief'))` |
| `title` | `text check (char_length between 1 and 200)` |
| `goal` | `text check (char_length between 1 and 1000)` |
| `week` | `text null check (<= 40)` |
| `source_title` | `text null check (<= 200)` |
| `created_at`, `updated_at` | `timestamptz default clock_timestamp()` |

Composite FKs: `(client_id, account_id) → clients(id, account_id) on delete cascade`
and `(profile_id, account_id) → profiles(id, account_id)`. A unique key
`(id, account_id, client_id, profile_id)` is the parent target for turns.
Recent-list index: `(account_id, client_id, profile_id, updated_at desc, id desc)`.

### `studio_thread_turns`

| Column | Type / constraint |
| --- | --- |
| `id` | `uuid primary key default gen_random_uuid()` |
| `thread_id`, `account_id`, `client_id`, `profile_id` | denormalized owner principal |
| `position` | `integer check (>= 0)`, `unique(thread_id, position)` |
| `prompt` | `text check (char_length between 1 and 1000)` |
| `task` | `text null` (Studio home template enum) |
| `reply` | `jsonb not null`, object, `octet_length(reply::text) <= 65536` |
| `attached` | `jsonb null`, `{label, versionNumber}` only, `<= 4096` bytes |
| `live` | `jsonb null`, final `StudioLiveReply` or `{error}`, never `pending`, `<= 65536` |
| `created_at` | `timestamptz default clock_timestamp()` |

Composite FK `(thread_id, account_id, client_id, profile_id) → studio_threads(...)`
with `on delete cascade` means a turn can never cross parents.

Both tables enable RLS and revoke `public`, `anon`, `authenticated` and
`service_role`, matching 080. There are no policies; the direct `DATABASE_URL`
role is the only consumer.

## Caps and errors

- List: newest 50 threads; `truncated: true` when more exist. The list is not a
  hard delete boundary.
- Threads per principal-brand: 200. Creating beyond the cap returns `409 STUDIO_THREAD_FULL`.
- Turns per thread: 50. Appending beyond the cap returns `409 STUDIO_THREAD_FULL`.
- Thread create body limit 4 KiB; turn body limit 96 KiB.
- Prompt/goal limit 1000 characters; title/source title 200.

| Status | Code |
| --- | --- |
| 401 | `UNAUTHENTICATED` |
| 404 | `NOT_FOUND` (bad/foreign client or thread, feature off) |
| 400 | `INVALID_STUDIO_THREAD` (unknown key, shape, oversize body) |
| 409 | `STUDIO_THREAD_FULL` |
| 503 | `STUDIO_THREADS_UNAVAILABLE` (including missing tables) |

Every response sets `Cache-Control: no-store`.

## API

All routes reuse the `answerStudio` auth pattern (`getProfile()` → UUID check →
owned **active** client → `conversation_studio` feature). They are **not** gated
on `conversation_studio_live`.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/dashboard/clients/[clientId]/studio/threads` | Metadata list + turn count |
| `POST` | `/api/dashboard/clients/[clientId]/studio/threads` | Create thread |
| `GET` | `/api/dashboard/clients/[clientId]/studio/threads/[threadId]` | Thread + turns |
| `POST` | `/api/dashboard/clients/[clientId]/studio/threads/[threadId]/turns` | Append a turn |
| `PATCH` | `/api/dashboard/clients/[clientId]/studio/threads/[threadId]/turns` | Finalize LIVE at `position` |

Every SQL statement includes `account_id`, `client_id` and `profile_id`.
Foreign rows are treated as absent (`404`), never `403`.

## Rollback

No down-migration convention exists in this repo. If 081 must be reverted on a
disposable/local database:

```sql
drop table if exists studio_thread_turns;
drop table if exists studio_threads;
delete from schema_migrations where filename = '081_studio_private_threads.sql';
```

The application degrades honestly when the tables are absent: reads return
`503 STUDIO_THREADS_UNAVAILABLE`, the UI shows `readUnavailable`, and newly
created threads stay `Not saved`/`未儲存`. It never falls back to claiming the
threads were persisted.

## Hosted migration

Applying 081 to Preview or Production Neon is a **separate GM Approve**. This
PR does not run `npm run migrate` against hosted Neon, does not flip FEATURE or
LIVE, and does not change `STUDIO_LIVE_ANSWERS_PER_WEEK` or any Vercel
environment variable.

## NO_GOs

- Prod/Preview LIVE ON, weekly cap raises, FEATURE/env flips
- Applying 081 to hosted Neon in this PR
- Thread sharing, teammate/manager visibility, admin read-through, export,
  delete/rename UX
- Persisting composer drafts, source bodies, or using saved snapshots as
  work-item evidence
- New Studio product surface/nav/default-home flip
- Stage 6d/6e/6f, CloudAgent, or changes to `lib/work-items/**`
