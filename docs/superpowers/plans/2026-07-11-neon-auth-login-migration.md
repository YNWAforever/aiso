# Neon Auth Login Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dead-Supabase login flow with Neon Auth (Better Auth-based), keeping magic-link and Google sign-in, without changing the contract any of the ~38 other files rely on (`getProfile()`/`requireAuth()`/`requireAdmin()` from `lib/auth.ts`).

**Architecture:** A new `lib/neon-auth.ts` wraps `createNeonAuth()` from `@neondatabase/auth/next/server`, exposing `.handler()` for a catch-all API route and `.middleware()`-equivalent session data for `proxy.ts`. `lib/auth.ts` keeps its exact function signatures but reads the session from Neon Auth and queries `profiles`/`accounts` from Neon via the existing `lib/db.ts`. `components/auth/LoginForm.tsx` swaps `@supabase/ssr`'s browser client for `@neondatabase/auth/next`'s `createAuthClient()`. A new webhook route provisions `accounts`+`profiles` rows on first sign-in, replacing the old Postgres trigger.

**Tech Stack:** `@neondatabase/auth` v0.4.2-beta (confirmed real, ground-truth-verified from the shipped package — not doc pages), Next.js 16 (`proxy.ts`, Node runtime), existing `lib/db.ts` (`@neondatabase/serverless` tagged-template SQL), Vitest.

---

## Ground truth used in this plan (verified, not assumed)

Downloaded and read the actual `@neondatabase/auth@0.4.2-beta` package (`npm pack` + read the shipped `.d.mts`/`.mjs`, not just doc pages — the same rigor used earlier to verify the legacy SDK). Confirmed:

- `createNeonAuth({ baseUrl, cookies: { secret } })` (from `@neondatabase/auth/next/server`) returns an object with **all Better Auth server methods** plus two added methods:
  - `.handler()` → `{ GET, POST, PUT, DELETE, PATCH }` for `app/api/auth/[...path]/route.ts` (path confirmed via the JSDoc example embedded in the compiled source itself).
  - `.middleware({ loginUrl })` → a `(request: NextRequest) => Promise<NextResponse>` function, usable as `proxy.ts`'s default export directly — but this project's `proxy.ts` has custom protected-path/admin logic composed with next-intl routing, so this plan uses the underlying Better Auth session read (`auth.api.getSession({ headers })` — Better Auth's long-standing, stable server API) rather than the all-in-one `.middleware()`, so it can compose with the existing logic.
- `createAuthClient()` (from `@neondatabase/auth/next`, client-side) returns a Better Auth React client with (all confirmed via the shipped `.d.mts`):
  - `signIn.magicLink({ email, callbackURL?, newUserCallbackURL?, errorCallbackURL? })` → `Promise<{ data: { status: boolean } | null, error: { code?: string, message?: string } | null }>`
  - `signIn.social({ provider: 'google', callbackURL?, newUserCallbackURL?, errorCallbackURL? })` → `Promise<{ data: { redirect: boolean, url: string } | null, error: { code?: string, message?: string } | null }>` — by default triggers a browser redirect on success; the `{ error }` half is available *before* any navigation happens, unlike the old Supabase call this replaces (which had zero error handling).
- Neon's own docs (`neon.com/docs/auth/overview`, fetched live): Neon Auth is genuinely powered by Better Auth, and is in **Beta** — corroborated independently by the npm registry showing all published versions as `0.x.x-beta`.
- **Schema check against the live Neon database** (`red-firefly-93523049`) run this session: `profiles.id` currently has `FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE` — a leftover from the original Supabase-authored migration. An `auth` schema with an empty `auth.users` stub exists, but **no `neon_auth` schema exists yet** (expected — Neon Auth isn't enabled on this project yet). This FK must be repointed at `neon_auth.user(id)` once Neon Auth is enabled — see Task 2 and the Manual Prerequisite Checkpoint.
- `neon_auth.user.id` is `uuid` (confirmed in earlier research against Neon's official Next.js + Drizzle guide), matching `profiles.id uuid`, so no type-cast is needed once the FK is repointed.

---

## File Structure

**Create:**
- `lib/neon-auth.ts` — server-side Neon Auth instance (mirrors the existing `lib/db.ts` lazy-singleton pattern).
- `app/api/auth/[...path]/route.ts` — Neon Auth's catch-all route handler.
- `app/api/webhooks/neon/route.ts` — `user.created` webhook, provisions `accounts`+`profiles`.
- `supabase/migrations/022_profiles_neon_auth_fk.sql` — repoints `profiles.id`'s FK from `auth.users` to `neon_auth.user` (file created now; **applying it is gated on Willy enabling Neon Auth first** — see Manual Prerequisite Checkpoint).
- `__tests__/lib/auth.test.ts` — coverage for the reimplemented `getProfile()`/`requireAuth()`/`requireAdmin()`.

**Modify:**
- `lib/auth.ts` — reimplement using `lib/neon-auth.ts` + `lib/db.ts` instead of `lib/supabase-server.ts`. Exact same exported function signatures.
- `proxy.ts` — swap the Supabase session check for a Neon Auth session read; delete the now-dead Supabase `?code=` fallback block (lines 14-29 of the current file).
- `components/auth/LoginForm.tsx` — swap `@supabase/ssr`'s `createBrowserClient()` calls for `@neondatabase/auth/next`'s `createAuthClient()`; fix the Google-button error-handling gap found during the original bug reproduction.
- `.env.local` — add `NEON_AUTH_BASE_URL` and `NEON_AUTH_COOKIE_SECRET` (values come from Willy after Task's Manual Prerequisite Checkpoint).

**Delete:**
- `app/[lang]/auth/callback/route.ts` — pure Supabase `exchangeCodeForSession()` logic, no other business logic. Neon Auth handles its own callback internally via `/api/auth/[...path]`.
- `app/auth/callback/route.ts` — same as above, the non-locale-prefixed duplicate.

**Untouched (explicitly out of scope):** `lib/supabase.ts`, `lib/supabase-server.ts` — still imported by ~38 other files reading application data; a separate follow-up.

---

### Task 1: Install the package and create the server auth instance

**Files:**
- Modify: `package.json`
- Create: `lib/neon-auth.ts`

- [ ] **Step 1: Install `@neondatabase/auth`**

Run: `npm install @neondatabase/auth@0.4.2-beta`

Expected: `package.json` gains `"@neondatabase/auth": "0.4.2-beta"` under `dependencies`.

- [ ] **Step 2: Create the server auth instance**

Create `lib/neon-auth.ts`:

```ts
import { createNeonAuth } from '@neondatabase/auth/next/server'

// Lazy singleton — createNeonAuth is deferred until first use so that
// module evaluation at Next.js build time (when env vars may be absent)
// does not throw.
type NeonAuthInstance = ReturnType<typeof createNeonAuth>

let _instance: NeonAuthInstance | null = null

export function auth(): NeonAuthInstance {
  if (!_instance) {
    _instance = createNeonAuth({
      baseUrl: process.env.NEON_AUTH_BASE_URL!,
      cookies: {
        secret: process.env.NEON_AUTH_COOKIE_SECRET!,
      },
    })
  }
  return _instance
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new errors referencing `lib/neon-auth.ts` (env vars aren't set yet locally — that's fine, this is a type check, not a runtime call).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json lib/neon-auth.ts
git commit -m "feat(auth): add Neon Auth server instance"
```

---

### Task 2: Write the profiles FK migration (write now, apply later)

**Files:**
- Create: `supabase/migrations/022_profiles_neon_auth_fk.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/022_profiles_neon_auth_fk.sql`:

```sql
-- Repoint profiles.id from the dead Supabase auth.users to Neon Auth's
-- neon_auth.user table. Safe to run any time after Neon Auth is enabled
-- on this project (neon_auth.user must exist first) — profiles has zero
-- rows in production as of this migration, so no data migration is needed.

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;

ALTER TABLE profiles
  ADD CONSTRAINT profiles_id_fkey
  FOREIGN KEY (id) REFERENCES neon_auth.user(id) ON DELETE CASCADE;
```

- [ ] **Step 2: Commit (do NOT apply yet — see Manual Prerequisite Checkpoint below)**

```bash
git add supabase/migrations/022_profiles_neon_auth_fk.sql
git commit -m "feat(auth): add migration repointing profiles FK to neon_auth.user"
```

---

### Task 3: Add the Neon Auth catch-all API route

**Files:**
- Create: `app/api/auth/[...path]/route.ts`

- [ ] **Step 1: Create the route**

Create `app/api/auth/[...path]/route.ts`:

```ts
import { auth } from '@/lib/neon-auth'

export const { GET, POST, PUT, DELETE, PATCH } = auth().handler()
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add "app/api/auth/[...path]/route.ts"
git commit -m "feat(auth): add Neon Auth catch-all route handler"
```

---

### Task 4: Add the signup webhook route

**Files:**
- Create: `app/api/webhooks/neon/route.ts`
- Test: `__tests__/api/webhooks-neon.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/api/webhooks-neon.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const sqlMock = vi.fn()
vi.mock('@/lib/db', () => ({ db: () => sqlMock }))

describe('POST /api/webhooks/neon', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sqlMock.mockResolvedValue([{ id: 'account-abc' }])
  })

  it('returns 400 for an unrecognized event type', async () => {
    const { POST } = await import('@/app/api/webhooks/neon/route')
    const req = new NextRequest('http://localhost/api/webhooks/neon', {
      method: 'POST',
      body: JSON.stringify({ type: 'something.else', data: {} }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('provisions an account and profile on user.created', async () => {
    const { POST } = await import('@/app/api/webhooks/neon/route')
    const req = new NextRequest('http://localhost/api/webhooks/neon', {
      method: 'POST',
      body: JSON.stringify({
        type: 'user.created',
        data: { id: 'user-123', email: 'new@example.com', name: 'New User' },
      }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    // First call creates the account, second links the profile
    expect(sqlMock).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/api/webhooks-neon.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/webhooks/neon/route'`

- [ ] **Step 3: Write the implementation**

Create `app/api/webhooks/neon/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

type NeonAuthWebhookEvent = {
  type: string
  data: { id: string; email: string; name?: string | null }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as NeonAuthWebhookEvent | null
  if (!body || typeof body.type !== 'string') {
    return NextResponse.json({ error: 'Invalid webhook payload' }, { status: 400 })
  }

  if (body.type !== 'user.created') {
    return NextResponse.json({ error: 'Unhandled event type' }, { status: 400 })
  }

  const { id: userId, email } = body.data
  if (!userId || !email) {
    return NextResponse.json({ error: 'Missing user id or email' }, { status: 400 })
  }

  const sql = db()
  try {
    const accountRows = await sql`
      insert into accounts (plan, status)
      values ('basic', 'active')
      returning id
    `
    const accountId = (accountRows[0] as { id: string }).id

    await sql`
      insert into profiles (id, account_id, display_name)
      values (${userId}, ${accountId}, ${body.data.name ?? null})
      on conflict (id) do nothing
    `
  } catch (err) {
    console.error('[webhooks/neon] provisioning failed:', (err as Error)?.message ?? String(err))
    return NextResponse.json({ error: 'Provisioning failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/api/webhooks-neon.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add app/api/webhooks/neon/route.ts __tests__/api/webhooks-neon.test.ts
git commit -m "feat(auth): add Neon Auth user.created signup webhook"
```

**Known gap, flagged not silently shipped:** this webhook does not verify a signature — the research this plan is based on did not turn up a ground-truth-verified signing mechanism for Neon Auth's webhooks (only an example handler with no auth check shown). As written, anyone who discovers this URL could POST a fake `user.created` event and provision an `accounts`+`profiles` row for an arbitrary id/email — low blast radius (no session is granted, no data exposed, just an unused row created) but still worth closing. Before relying on this in production, check the Neon Auth console for a webhook secret/signing header and add verification; do not treat this task as done from a security standpoint until that's confirmed.

---

### Task 5: Reimplement `lib/auth.ts`

**Files:**
- Modify: `lib/auth.ts`
- Test: `__tests__/lib/auth.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/auth.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const getSessionMock = vi.fn()
vi.mock('@/lib/neon-auth', () => ({
  auth: () => ({ api: { getSession: getSessionMock } }),
}))

const sqlMock = vi.fn()
vi.mock('@/lib/db', () => ({ db: () => sqlMock }))

vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
}))

const redirectMock = vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`) })
vi.mock('next/navigation', () => ({ redirect: redirectMock }))

describe('lib/auth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('getProfile returns null when there is no session', async () => {
    getSessionMock.mockResolvedValue(null)
    const { getProfile } = await import('@/lib/auth')
    expect(await getProfile()).toBeNull()
  })

  it('getProfile returns null when the session has no matching profile row', async () => {
    getSessionMock.mockResolvedValue({ user: { id: 'user-1', email: 'a@b.com' } })
    sqlMock.mockResolvedValue([])
    const { getProfile } = await import('@/lib/auth')
    expect(await getProfile()).toBeNull()
  })

  it('getProfile returns the profile with account and attached email', async () => {
    getSessionMock.mockResolvedValue({ user: { id: 'user-1', email: 'a@b.com' } })
    sqlMock.mockResolvedValue([{
      id: 'user-1', account_id: 'acc-1', display_name: 'A', is_admin: false,
      created_at: '2026-01-01T00:00:00Z',
      account_id_2: 'acc-1', plan: 'basic', status: 'active',
      stripe_customer_id: null, stripe_subscription_id: null,
      trial_started_at: null, trial_ends_at: null, trial_emails_sent: 0,
      account_created_at: '2026-01-01T00:00:00Z',
    }])
    const { getProfile } = await import('@/lib/auth')
    const profile = await getProfile()
    expect(profile?.email).toBe('a@b.com')
    expect(profile?.accounts.plan).toBe('basic')
  })

  it('requireAuth redirects to login when there is no profile', async () => {
    getSessionMock.mockResolvedValue(null)
    const { requireAuth } = await import('@/lib/auth')
    await expect(requireAuth('en')).rejects.toThrow('REDIRECT:/en/auth/login')
  })

  it('requireAdmin redirects to dashboard when the profile is not an admin', async () => {
    getSessionMock.mockResolvedValue({ user: { id: 'user-1', email: 'a@b.com' } })
    sqlMock.mockResolvedValue([{
      id: 'user-1', account_id: 'acc-1', display_name: 'A', is_admin: false,
      created_at: '2026-01-01T00:00:00Z',
      account_id_2: 'acc-1', plan: 'basic', status: 'active',
      stripe_customer_id: null, stripe_subscription_id: null,
      trial_started_at: null, trial_ends_at: null, trial_emails_sent: 0,
      account_created_at: '2026-01-01T00:00:00Z',
    }])
    const { requireAdmin } = await import('@/lib/auth')
    await expect(requireAdmin('en')).rejects.toThrow('REDIRECT:/en/dashboard')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/auth.test.ts`
Expected: FAIL — current `lib/auth.ts` still imports `lib/supabase-server.ts`, so `getSessionMock`/`sqlMock` are never called and assertions fail.

- [ ] **Step 3: Write the implementation**

Replace `lib/auth.ts`:

```ts
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { auth } from '@/lib/neon-auth'
import { db } from '@/lib/db'
import type { ProfileWithAccount } from '@/lib/types'

export async function getProfile(): Promise<ProfileWithAccount | null> {
  const session = await auth().api.getSession({ headers: await headers() })
  if (!session?.user) return null

  const sql = db()
  const rows = await sql`
    select
      p.id, p.account_id, p.display_name, p.is_admin, p.created_at,
      a.id as account_id_2, a.plan, a.status, a.stripe_customer_id,
      a.stripe_subscription_id, a.trial_started_at, a.trial_ends_at,
      a.trial_emails_sent, a.created_at as account_created_at
    from profiles p
    join accounts a on a.id = p.account_id
    where p.id = ${session.user.id}
    limit 1
  `
  const row = rows[0] as Record<string, unknown> | undefined
  if (!row) return null

  return {
    id: row.id,
    account_id: row.account_id,
    display_name: row.display_name,
    is_admin: row.is_admin,
    created_at: row.created_at,
    email: session.user.email ?? null,
    accounts: {
      id: row.account_id_2,
      plan: row.plan,
      status: row.status,
      stripe_customer_id: row.stripe_customer_id,
      stripe_subscription_id: row.stripe_subscription_id,
      trial_started_at: row.trial_started_at,
      trial_ends_at: row.trial_ends_at,
      trial_emails_sent: row.trial_emails_sent,
      created_at: row.account_created_at,
    },
  } as unknown as ProfileWithAccount
}

export async function requireAuth(lang = 'en'): Promise<ProfileWithAccount> {
  const profile = await getProfile()
  if (!profile) redirect(`/${lang}/auth/login`)
  return profile
}

export async function requireAdmin(lang = 'en'): Promise<ProfileWithAccount> {
  const profile = await requireAuth(lang)
  if (!profile.is_admin) redirect(`/${lang}/dashboard`)
  return profile
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/auth.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/auth.ts __tests__/lib/auth.test.ts
git commit -m "feat(auth): reimplement getProfile/requireAuth/requireAdmin on Neon Auth"
```

---

### Task 6: Rewrite `proxy.ts`

**Files:**
- Modify: `proxy.ts`

- [ ] **Step 1: Replace the Supabase session check with Neon Auth**

Replace the full contents of `proxy.ts`:

```ts
import { NextResponse, type NextRequest } from 'next/server'
import createIntlMiddleware from 'next-intl/middleware'
import { routing } from './i18n/routing'
import { auth } from '@/lib/neon-auth'
import { db } from '@/lib/db'

const intlMiddleware = createIntlMiddleware(routing)

const PROTECTED_PATHS = ['/dashboard', '/admin']
const ADMIN_PATHS = ['/admin']

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Strip lang prefix to check path
  const strippedPath = pathname.replace(/^\/(en|zh-HK)/, '') || '/'
  const isProtected = PROTECTED_PATHS.some(p => strippedPath.startsWith(p))
  const isAdmin = ADMIN_PATHS.some(p => strippedPath.startsWith(p))

  if (isProtected) {
    const session = await auth().api.getSession({ headers: request.headers })

    if (!session?.user) {
      const loginUrl = request.nextUrl.clone()
      const langMatch = pathname.match(/^\/(en|zh-HK)/)
      const lang = langMatch ? langMatch[1] : 'en'
      loginUrl.pathname = `/${lang}/auth/login`
      loginUrl.searchParams.set('next', pathname)
      return NextResponse.redirect(loginUrl)
    }

    if (isAdmin) {
      const sql = db()
      const rows = await sql`select is_admin from profiles where id = ${session.user.id} limit 1`
      const profile = rows[0] as { is_admin: boolean } | undefined
      if (!profile?.is_admin) {
        const dashUrl = request.nextUrl.clone()
        const adminLangMatch = pathname.match(/^\/(en|zh-HK)/)
        dashUrl.pathname = `/${adminLangMatch ? adminLangMatch[1] : 'en'}/dashboard`
        return NextResponse.redirect(dashUrl)
      }
    }

    return NextResponse.next({ request })
  }

  return intlMiddleware(request)
}

export const config = {
  matcher: ['/((?!api|_next|.*\\..*).*)'],
}
```

Note: the `auth/callback` exclusion is removed from the matcher (that route no longer exists after Task 8), and the Supabase `?code=` fallback block is dropped entirely — Neon Auth's magic-link/OAuth callbacks are handled internally by the catch-all route from Task 3, never hitting `proxy.ts` as a bare `?code=` param.

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add proxy.ts
git commit -m "feat(auth): rewrite proxy.ts session check on Neon Auth"
```

---

### Task 7: Rewrite `components/auth/LoginForm.tsx`

**Files:**
- Modify: `components/auth/LoginForm.tsx`

- [ ] **Step 1: Replace the Supabase client calls**

Replace the full contents of `components/auth/LoginForm.tsx`:

```tsx
'use client'
import { useState } from 'react'
import { useLocale } from 'next-intl'
import { createAuthClient } from '@neondatabase/auth/next'
import { Button } from '@/components/ui/button'
import { Input }  from '@/components/ui/input'

const COPY_EN = {
  checkEmail: 'Check your email',
  sentTo: (email: string) => <>We sent a magic link to <strong>{email}</strong></>,
  continueWithGoogle: 'Continue with Google',
  or: 'or',
  sending: 'Sending…',
  sendMagicLink: 'Send Magic Link',
  emailPlaceholder: 'you@company.com',
  tooManyAttempts: 'Too many attempts. Please wait a few minutes before trying again.',
  googleFailed: 'Could not start Google sign-in. Please try again.',
}

const COPY_ZH_HK: typeof COPY_EN = {
  checkEmail: '請查看你的電郵',
  sentTo: (email: string) => <>我們已將登入連結發送至 <strong>{email}</strong></>,
  continueWithGoogle: '使用 Google 繼續',
  or: '或',
  sending: '發送中…',
  sendMagicLink: '發送登入連結',
  emailPlaceholder: 'you@company.com',
  tooManyAttempts: '嘗試次數過多，請等待幾分鐘後再試。',
  googleFailed: '無法啟動 Google 登入，請再試一次。',
}

const authClient = createAuthClient()

export function LoginForm({ next }: { next?: string }) {
  const locale = useLocale()
  const c = locale === 'zh-HK' ? COPY_ZH_HK : COPY_EN
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  const callbackURL = `${typeof window !== 'undefined' ? window.location.origin : ''}${next ?? '/dashboard'}`

  const signInWithGoogle = async () => {
    setErrorMsg('')
    const { error } = await authClient.signIn.social({ provider: 'google', callbackURL })
    if (error) setErrorMsg(c.googleFailed)
  }

  const signInWithMagicLink = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setErrorMsg('')
    const { error } = await authClient.signIn.magicLink({ email, callbackURL })
    if (error) {
      setErrorMsg(
        error.code === 'TOO_MANY_ATTEMPTS'
          ? c.tooManyAttempts
          : (error.message ?? c.googleFailed)
      )
      setLoading(false)
    } else {
      setSent(true)
      setLoading(false)
    }
  }

  if (sent) {
    return (
      <div className="text-center">
        <p className="text-foreground font-medium">{c.checkEmail}</p>
        <p className="text-muted-foreground text-sm mt-1">{c.sentTo(email)}</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <Button
        variant="outline"
        onClick={signInWithGoogle}
        className="w-full justify-center gap-3"
      >
        <svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 0 0 2.38-5.88c0-.57-.05-.66-.15-1.18z"/><path fill="#34A853" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2a4.8 4.8 0 0 1-7.18-2.54H1.83v2.07A8 8 0 0 0 8.98 17z"/><path fill="#FBBC05" d="M4.5 10.52a4.8 4.8 0 0 1 0-3.04V5.41H1.83a8 8 0 0 0 0 7.18l2.67-2.07z"/><path fill="#EA4335" d="M8.98 4.18c1.17 0 2.23.4 3.06 1.2l2.3-2.3A8 8 0 0 0 1.83 5.4L4.5 7.49a4.77 4.77 0 0 1 4.48-3.3z"/></svg>
        {c.continueWithGoogle}
      </Button>

      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-border" />
        <span className="text-xs text-muted-foreground">{c.or}</span>
        <div className="flex-1 h-px bg-border" />
      </div>

      <form onSubmit={signInWithMagicLink} className="space-y-3">
        <Input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder={c.emailPlaceholder}
          required
        />
        <Button type="submit" disabled={loading} className="w-full">
          {loading ? c.sending : c.sendMagicLink}
        </Button>
        {errorMsg && (
          <p className="text-destructive text-sm mt-2">{errorMsg}</p>
        )}
      </form>
    </div>
  )
}
```

Note: `next` now feeds a same-origin `callbackURL` directly (Neon Auth's own catch-all route performs the redirect after session exchange), replacing the old `/auth/callback?next=...` indirection — there is no callback route to forward through anymore.

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add components/auth/LoginForm.tsx
git commit -m "feat(auth): rewrite LoginForm on Neon Auth client SDK"
```

---

### Task 8: Delete the dead Supabase callback routes

**Files:**
- Delete: `app/[lang]/auth/callback/route.ts`
- Delete: `app/auth/callback/route.ts`

- [ ] **Step 1: Delete both files**

```bash
git rm "app/[lang]/auth/callback/route.ts" "app/auth/callback/route.ts"
```

- [ ] **Step 2: Verify nothing else references them**

Run: `grep -rn "auth/callback" app components lib --include='*.ts' --include='*.tsx'`
Expected: no matches (Task 7 already removed the only reference, in `LoginForm.tsx`).

- [ ] **Step 3: Commit**

```bash
git commit -m "chore(auth): remove dead Supabase OAuth callback routes"
```

---

### Task 9: Full local verification (build/lint/test)

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests pass, including the new `__tests__/lib/auth.test.ts` and `__tests__/api/webhooks-neon.test.ts`.

- [ ] **Step 2: Run the linter**

Run: `npm run lint`
Expected: 0 errors (pre-existing warnings are fine, matching the current baseline).

- [ ] **Step 3: Run the type checker**

Run: `npx tsc --noEmit`
Expected: 0 errors in any file touched by this plan.

- [ ] **Step 4: Run the production build**

Run: `npm run build`
Expected: exit code 0. Note: this will succeed even without `NEON_AUTH_BASE_URL`/`NEON_AUTH_COOKIE_SECRET` set, because `lib/neon-auth.ts` defers `createNeonAuth()` until first request (same lazy-singleton pattern as `lib/db.ts`), matching this project's established convention for env-dependent clients.

- [ ] **Step 5: Commit if any fixes were needed**

If any of the above required fixes, commit them now with a message describing what was fixed.

---

## Manual Prerequisite Checkpoint (Willy — not automatable)

Everything above can be built and unit-tested without this. Live verification (Task 10) cannot proceed until these are done:

1. **Enable Neon Auth** on the `red-firefly-93523049` Neon project via Neon Console → Auth. This provisions `neon_auth.user` and gives you the value for `NEON_AUTH_BASE_URL`.
2. **Generate a cookie secret**: run `openssl rand -base64 32` and save the output.
3. **Set both in `.env.local`** and in Vercel (Production + Preview, same as `DATABASE_URL` was added earlier this session):
   - `NEON_AUTH_BASE_URL`
   - `NEON_AUTH_COOKIE_SECRET`
4. **Apply the migration** written in Task 2, now that `neon_auth.user` exists. Run from the project root, same pattern used to inspect the `profiles` FK earlier this session:
   ```bash
   set -a && source .env.local && set +a && node --input-type=module -e "
   import { readFileSync } from 'fs'
   import { Pool } from '@neondatabase/serverless'
   const pool = new Pool({ connectionString: process.env.DATABASE_URL })
   try {
     await pool.query(readFileSync('supabase/migrations/022_profiles_neon_auth_fk.sql', 'utf8'))
     console.log('migration applied')
   } finally { await pool.end() }
   "
   ```
   Expected: prints `migration applied`, no errors. Verify with the same constraint query used earlier this session (`select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.profiles'::regclass and contype = 'f'`) — `profiles_id_fkey` should now read `REFERENCES neon_auth.user(id)`.
5. **(Optional, for Google sign-in)** Register a Google OAuth client and configure it in the Neon Auth console. Magic link works without this — Google sign-in will show the `googleFailed` error message until this is done, which is safe (no crash, no dead redirect).

---

### Task 10: Live verification

**Files:** none (verification only) — run after the Manual Prerequisite Checkpoint above is complete.

- [ ] **Step 1: Start the dev server and drive the login flow**

Start the dev server, then reproduce the exact steps used to originally find this bug: navigate to `/zh-HK/auth/login`, submit a real email through the magic-link form, and confirm no `ERR_NAME_NOT_RESOLVED`/`Failed to fetch` appears — the request should now succeed against `NEON_AUTH_BASE_URL` instead of the dead Supabase host.

- [ ] **Step 2: Verify the protected-route redirect**

Navigate to `/en/dashboard` while logged out. Expected: redirected to `/en/auth/login?next=%2Fen%2Fdashboard`.

- [ ] **Step 3: Complete a real magic-link sign-in and verify provisioning**

Click the magic link from the email. Expected: redirected back into the app with a session; then check Neon directly (`select * from accounts; select * from profiles;`) — a new row should exist in each, created by the Task 4 webhook.

- [ ] **Step 4: Verify `/dashboard` is now reachable**

With the session from Step 3, navigate to `/en/dashboard`. Expected: 200, no redirect back to login.

- [ ] **Step 5: Deploy and repeat Steps 1-4 against the live Vercel URL**

Once local verification passes, push and deploy, then repeat the same manual checks against the deployed `fimmick-aeo-oitb` URL to confirm parity with production.
