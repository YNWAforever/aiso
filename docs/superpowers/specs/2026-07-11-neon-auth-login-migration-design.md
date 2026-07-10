# Neon Auth Login Migration — Design

## Problem

Login (`/[lang]/auth/login`) is non-functional in production. Root cause, confirmed by reproducing both auth paths live against the deployed site with full network/console evidence:

- **Magic link** (`components/auth/LoginForm.tsx`): `supabase.auth.signInWithOtp()` calls `POST https://ankmnirpytvbidyjyujh.supabase.co/auth/v1/otp` → `net::ERR_NAME_NOT_RESOLVED` → the raw `"Failed to fetch"` string is shown to the user.
- **Google OAuth**: `signInWithOAuth()` does a full-page redirect straight to the same dead host → Chrome's own "This site can't be reached" page. This code path has zero error handling, so it's a dead end with no way back but browser-back.

This is the identity-layer half of the incident already fixed for the data layer earlier this session: the Supabase project (`ankmnirpytvbidyjyujh.supabase.co`) that backed both the database and the auth service was deleted. The scan funnel was already migrated off Supabase onto Neon Postgres (`lib/db.ts`). Login was left broken because swapping the *data* layer doesn't fix the *identity provider* — that requires picking and integrating a replacement auth service, which is what this design covers.

## Decision

Replace Supabase Auth with **Neon Auth (Better Auth-based)** — the current, actively-developed Neon Auth product (`@neondatabase/auth`), not the legacy Stack Auth-based implementation. Confirmed directly against `neon.com/docs/auth/overview`: "Neon Auth is powered by Better Auth." It is in **Beta**. The legacy Stack-Auth-based Neon Auth still works for already-provisioned projects but is closed to new signups, and would otherwise require a fully separate vendor (Stack Auth, itself mid-rebrand to "Hexclave") with a hand-built sync mechanism into our Neon tables. Given this project already committed to Neon as its data platform, and has zero existing users to protect from Beta rough edges, staying in the Neon ecosystem is the architecturally coherent choice.

**Scope:** this migration covers the login-identity layer only — `lib/auth.ts`, `proxy.ts` middleware, `components/auth/LoginForm.tsx`, and a new signup webhook. The other ~38 files that still read application data via the dead `lib/supabase.ts`/`supabase-server.ts` clients (dashboard, Stripe, pulse, clients CRUD, etc.) are explicitly **out of scope** — already tracked as a separate follow-up. `getProfile()`/`requireAdmin()` keep their exact current return contract so none of those ~38 call sites need to change in this pass.

## Architecture

**New:**
- `lib/auth/server.ts` — `createNeonAuth({ baseUrl, cookies: { secret } })`, reading `NEON_AUTH_BASE_URL` (from Neon Console → Auth) and `NEON_AUTH_COOKIE_SECRET` (self-generated, `openssl rand -base64 32`).
- `lib/auth/client.ts` — `createAuthClient()` for browser-side magic-link/Google calls.
- `app/api/auth/[...path]/route.ts` — required catch-all proxying all Neon Auth traffic (sign-in, OAuth exchange, session refresh).
- `app/api/webhooks/neon/route.ts` — handles the `user.created` event: inserts an `accounts` row (`plan='basic'`) then a `profiles` row FK'd to `neon_auth.user.id`, via `lib/db.ts`. This is the direct replacement for the old Postgres `handle_new_user()` trigger (migrations 003/007/017).

**Changed:**
- `proxy.ts` — same shape (wraps next-intl routing, gates `/dashboard` and `/admin`), but the session check becomes Neon Auth's middleware helper instead of a Supabase `getUser()` call. Runs fine in Node runtime (Next.js 16's `proxy.ts` defaults to Node, not Edge).
- `lib/auth.ts` — `getProfile()`/`requireAdmin()` reimplemented: get the session from Neon Auth, look up the matching `profiles`/`accounts` row via `lib/db.ts`, return the same shape as today.
- `components/auth/LoginForm.tsx` — same bilingual UI and both buttons; Supabase calls swapped for Neon Auth's client SDK equivalents. The Google-button error-handling gap found during reproduction is fixed here too (currently swallows all failures silently).

## Data flow

1. User submits email on the login form → `LoginForm` calls the Neon Auth client SDK.
2. Neon Auth sends the magic-link email and handles verification through `app/api/auth/[...path]`.
3. On success: session cookie set, user redirected to `next` (or `/dashboard`).
4. First sign-in only: `user.created` webhook fires synchronously (no async mirror-table lag, unlike the legacy Stack Auth path) and provisions `accounts`+`profiles` in Neon.
5. `/dashboard` and `/admin` are gated by `proxy.ts`'s session check; any Server Component needing the user calls the unchanged-contract `getProfile()`.

## Error handling

- Magic-link errors map onto the existing bilingual error dictionary (`messages/en.json`/`zh-HK.json`); extended with whatever Neon Auth's actual error codes turn out to be once implementation starts.
- Google OAuth button gets the same try/catch + bilingual error display as magic link (currently has none — a confirmed bug fixed as part of this work).
- `app/api/webhooks/neon/route.ts` validates Neon's webhook signature before trusting the payload, and is idempotent (`ON CONFLICT DO NOTHING`) since delivery can retry.
- `getProfile()`/`requireAdmin()` never throw — matches the project's existing convention ("checks must never throw; degrade gracefully").
- `proxy.ts`'s session check fails **closed** (redirect to login) if the Neon Auth call itself errors — never fail open on a protected route.

## Testing

- New Vitest coverage for the reimplemented `getProfile()`/`requireAdmin()`, mocking the new auth + Neon DB calls (no existing test file covers the login form itself).
- Live verification via the same browser-automation approach used to reproduce the original bug: drive the deployed login page, confirm the magic-link request succeeds (no more `ERR_NAME_NOT_RESOLVED`), confirm `/dashboard` correctly gates logged-out users.

## Prerequisites (external, not code)

Two things only Willy can do, needed before this is fully live:
1. Enable Auth on the Neon project console → generates `NEON_AUTH_BASE_URL`.
2. Register a Google OAuth client if the Google sign-in button should keep working.

Magic link doesn't depend on #2, so login can ship without Google sign-in if that's deferred.

## Risks / open items for the implementation plan

- Neon Auth (Better Auth) is in **Beta** — API surface may shift. Mitigated by zero current users and by verifying the actual client SDK method names against the real `@neondatabase/auth` package (not assumed) as the first implementation step, the same way the research verified the legacy Stack Auth SDK by extracting and reading its shipped `.d.ts` files rather than trusting doc pages.
- Exact error-result shape returned by `@neondatabase/auth`'s client (`{ data, error }` vs. something else) needs confirming during implementation before the bilingual error-mapping code is written.
- Full end-to-end testing of the magic-link email round-trip and Google OAuth requires the prerequisites above from Willy.

## Out of scope

The remaining ~38 files still reading application data through the dead Supabase client (dashboard data, Stripe, Pulse, clients CRUD, cron, admin) are unaffected by this migration and remain a separate, already-tracked follow-up.
