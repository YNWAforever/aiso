# Move Cron Triggering to a Cloudflare Worker, and Restore trial-emails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore `cron/trial-emails` (ported to `db()`), then move scheduling of all three
cron routes (`pulse`, `evaluate-alerts`, `trial-emails`) from Vercel Cron to a Cloudflare
Worker, since Vercel's Hobby plan caps at 2 daily crons and Cloudflare's free tier allows 3
triggers per Worker.

**Architecture:** `cron/pulse` and `cron/evaluate-alerts` need zero code changes — the new
Worker calls them with the exact `Authorization: Bearer $CRON_SECRET` header Vercel Cron
already sends. `cron/trial-emails` gets its pre-fence logic (found in git history at
`71abd27~1`) ported from Supabase to `db()`, split into a pure, unit-testable "which emails
are due" module (`lib/trial-emails.ts`) and a route that does the I/O. `vercel.json` loses
its `crons` array (kept: the `functions` maxDuration entries, which apply regardless of
caller) once the Worker is verified working.

**Tech Stack:** Next.js API routes, `@neondatabase/serverless` (`db()`), Resend, Cloudflare
Workers + Cron Triggers (`wrangler`), Vitest.

---

### Task 1: `lib/trial-emails.ts` — pure due-email logic

**Files:**
- Create: `lib/trial-emails.ts`
- Test: `__tests__/lib/trial-emails.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// __tests__/lib/trial-emails.test.ts
import { describe, expect, it } from 'vitest'
import {
  EMAIL_DAY1, EMAIL_DAY5, EMAIL_DAY7, EMAIL_DAY10,
  daysSinceTrialStart, pendingTrialEmails,
} from '@/lib/trial-emails'

// A little past the exact N-day mark, so the floor in daysSinceTrialStart
// cannot land one short due to the few milliseconds the test itself takes.
function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000 - 60_000)
}

describe('daysSinceTrialStart', () => {
  it('accepts a Date, as the Neon driver returns for a timestamptz', () => {
    expect(daysSinceTrialStart(daysAgo(5))).toBe(5)
  })

  it('accepts an ISO string, as Supabase-era rows and test fixtures carry', () => {
    expect(daysSinceTrialStart(daysAgo(7).toISOString())).toBe(7)
  })

  it('is 0 on the day the trial starts', () => {
    expect(daysSinceTrialStart(new Date())).toBe(0)
  })
})

describe('pendingTrialEmails', () => {
  const appUrl = 'https://app.example.com'

  it('sends nothing before day 1', () => {
    expect(pendingTrialEmails(0, 0, appUrl)).toEqual([])
  })

  it('sends only day 1 at day 1 with nothing sent yet', () => {
    const due = pendingTrialEmails(1, 0, appUrl)

    expect(due).toHaveLength(1)
    expect(due[0].bit).toBe(EMAIL_DAY1)
    expect(due[0].subject).toContain('Fix Pack')
    expect(due[0].text).toContain(`${appUrl}/en/dashboard`)
  })

  it('does not resend day 1 once its bit is set', () => {
    expect(pendingTrialEmails(1, EMAIL_DAY1, appUrl)).toEqual([])
  })

  it('catches up on every email due at once, in order, if a run was missed', () => {
    const due = pendingTrialEmails(10, 0, appUrl)

    expect(due.map(e => e.bit)).toEqual([EMAIL_DAY1, EMAIL_DAY5, EMAIL_DAY7, EMAIL_DAY10])
  })

  it('sends only the ones not yet marked in the bitmask', () => {
    const due = pendingTrialEmails(10, EMAIL_DAY1 | EMAIL_DAY5, appUrl)

    expect(due.map(e => e.bit)).toEqual([EMAIL_DAY7, EMAIL_DAY10])
  })

  it('sends nothing once every bit is set', () => {
    const allSent = EMAIL_DAY1 | EMAIL_DAY5 | EMAIL_DAY7 | EMAIL_DAY10
    expect(pendingTrialEmails(100, allSent, appUrl)).toEqual([])
  })

  it('interpolates the app URL into every email body', () => {
    for (const email of pendingTrialEmails(10, 0, 'https://custom.example')) {
      expect(email.text).toContain('https://custom.example')
    }
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run __tests__/lib/trial-emails.test.ts`
Expected: FAIL — `Cannot find module '@/lib/trial-emails'`

- [ ] **Step 3: Write the implementation**

```typescript
// lib/trial-emails.ts

// Bitmask: which drip email has already been sent for an account.
export const EMAIL_DAY1 = 1
export const EMAIL_DAY5 = 2
export const EMAIL_DAY7 = 4
export const EMAIL_DAY10 = 8

export interface TrialEmail {
  bit: number
  subject: string
  text: string
}

/**
 * `accounts.trial_started_at` is a `timestamptz` — the Neon driver returns
 * those as a JS `Date`, but ISO strings still arrive from Supabase-era rows
 * and test fixtures. Mirrors lib/tier.ts's timestampMs: accept both.
 */
function timestampMs(raw: string | Date): number {
  return raw instanceof Date ? raw.getTime() : new Date(raw).getTime()
}

export function daysSinceTrialStart(startedAt: string | Date): number {
  return Math.floor((Date.now() - timestampMs(startedAt)) / (1000 * 60 * 60 * 24))
}

/** Which of the 4 drip emails are newly due, given elapsed days and what's already sent. */
export function pendingTrialEmails(days: number, sentMask: number, appUrl: string): TrialEmail[] {
  const toSend: TrialEmail[] = []

  if (days >= 1 && !(sentMask & EMAIL_DAY1)) {
    toSend.push({
      bit: EMAIL_DAY1,
      subject: '✅ Your AISO Fix Pack is ready — deploy these 3 files',
      text: `Your 7-day trial is active.\n\nDownload your Fix Pack from your dashboard:\n${appUrl}/en/dashboard\n\nThe 3 files (llms.txt, robots.txt patch, FAQ schema) are ready to deploy. Most sites see AI indexing improve within 48 hours of deploying llms.txt.\n\nYou have 6 days remaining on your trial.\n\n— Fimmick AISO`,
    })
  }
  if (days >= 5 && !(sentMask & EMAIL_DAY5)) {
    toSend.push({
      bit: EMAIL_DAY5,
      subject: "⏳ 2 days left — here's what you're missing in Pulse",
      text: `Your trial ends in 2 days.\n\nYou haven't seen AI Pulse yet — it tracks your brand's share of voice across ChatGPT, Perplexity, Claude, and Gemini every week.\n\nUpgrade to Pro and see where your brand shows up (and doesn't):\n${appUrl}/en/pricing\n\n— Fimmick AISO`,
    })
  }
  if (days >= 7 && !(sentMask & EMAIL_DAY7)) {
    toSend.push({
      bit: EMAIL_DAY7,
      subject: '🔔 Last day of your AISO trial',
      text: `Today is the last day of your free trial.\n\nKeep your dashboard, Fix Pack, and AI visibility report by upgrading:\n${appUrl}/en/pricing\n\nBasic plan starts at $29/month — no credit card was required for your trial, but you'll need one to continue.\n\n— Fimmick AISO`,
    })
  }
  if (days >= 10 && !(sentMask & EMAIL_DAY10)) {
    toSend.push({
      bit: EMAIL_DAY10,
      subject: 'Your AISO report is saved — come back anytime',
      text: `Your trial ended a few days ago, but your scan report and AISO score are still waiting for you.\n\nNo pressure — whenever you're ready:\n${appUrl}/en/pricing\n\n— Fimmick AISO`,
    })
  }

  return toSend
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run __tests__/lib/trial-emails.test.ts`
Expected: PASS — 10 tests

- [ ] **Step 5: Commit**

```bash
git add lib/trial-emails.ts __tests__/lib/trial-emails.test.ts
git commit -m "feat(trial): add pure due-email logic for the trial drip campaign"
```

---

### Task 2: `lib/resend.ts` — add `sendTrialEmail`

**Files:**
- Modify: `lib/resend.ts`
- Test: `__tests__/lib/resend.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `__tests__/lib/resend.test.ts` (same file, new `describe` block below the existing
`sendAlertEmail` one — the mock of the `resend` package at the top of the file already covers
both functions):

```typescript
// Add this import alongside the existing one at the top of the file:
// import { sendAlertEmail, sendTrialEmail } from '@/lib/resend'

describe('sendTrialEmail', () => {
  beforeEach(() => {
    h.send.mockReset()
    process.env.RESEND_API_KEY = 'test-resend-key'
  })

  it('sends with the trial-emails default from-address when unset', async () => {
    delete process.env.RESEND_FROM_EMAIL
    h.send.mockResolvedValue({ data: { id: 'email-1' }, error: null })

    await sendTrialEmail({ to: 'user@example.com', subject: 'Hi', text: 'Body' })

    expect(h.send).toHaveBeenCalledWith({
      from: 'hello@fimmick-aeo.com',
      to: 'user@example.com',
      subject: 'Hi',
      text: 'Body',
    })
  })

  it('rejects when Resend resolves with a provider error object', async () => {
    const providerError = { message: 'Invalid API key', name: 'validation_error' }
    h.send.mockResolvedValue({ data: null, error: providerError })

    let thrown: unknown
    await sendTrialEmail({ to: 'user@example.com', subject: 'Hi', text: 'Body' }).catch(error => {
      thrown = error
    })

    expect(thrown).toBeInstanceOf(Error)
    expect(thrown).toMatchObject({
      message: 'Resend trial email failed',
      cause: providerError,
    })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/lib/resend.test.ts`
Expected: FAIL — `sendTrialEmail is not exported`

- [ ] **Step 3: Add the implementation**

Append to `lib/resend.ts` (leave the existing `sendAlertEmail` function untouched):

```typescript
export async function sendTrialEmail({
  to,
  subject,
  text,
}: {
  to: string
  subject: string
  text: string
}) {
  const resend = new Resend(process.env.RESEND_API_KEY)

  const { error } = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL ?? 'hello@fimmick-aeo.com',
    to,
    subject,
    text,
  })

  if (error) {
    throw new Error('Resend trial email failed', { cause: error })
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run __tests__/lib/resend.test.ts`
Expected: PASS — all tests in the file, both `sendAlertEmail` and `sendTrialEmail`

- [ ] **Step 5: Commit**

```bash
git add lib/resend.ts __tests__/lib/resend.test.ts
git commit -m "feat(trial): add sendTrialEmail alongside sendAlertEmail"
```

---

### Task 3: Restore `app/api/cron/trial-emails/route.ts`

**Files:**
- Modify: `app/api/cron/trial-emails/route.ts` (currently a `featureUnavailable` stub)
- Modify: `__tests__/api/fenced-routes.test.ts` (remove the trial-emails entry)
- Modify: `vercel.json` (add a `maxDuration` entry)
- Test: `__tests__/api/cron/trial-emails.test.ts` (new)

- [ ] **Step 1: Write the failing tests**

```typescript
// __tests__/api/cron/trial-emails.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  db: vi.fn(),
  sendTrialEmail: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ db: h.db }))
vi.mock('@/lib/resend', () => ({ sendTrialEmail: h.sendTrialEmail }))

async function importRoute() {
  vi.resetModules()
  return import('@/app/api/cron/trial-emails/route')
}

function request(bearer?: string) {
  return new Request('https://app.example/api/cron/trial-emails', {
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
  })
}

function accountRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'account-1',
    trial_started_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000 - 60_000),
    trial_emails_sent: 0,
    email: 'owner@example.com',
    ...overrides,
  }
}

describe('GET /api/cron/trial-emails', () => {
  const originalCronSecret = process.env.CRON_SECRET
  let mockSql: ReturnType<typeof vi.fn>
  let rows: unknown[]

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'test-cron-secret-0123'
    rows = [accountRow()]
    mockSql = vi.fn((strings: TemplateStringsArray, ...params: unknown[]) => {
      const text = strings.join('?')
      if (text.includes('UPDATE accounts')) return Promise.resolve([])
      void params
      return Promise.resolve(rows)
    })
    h.db.mockReturnValue(mockSql)
    h.sendTrialEmail.mockResolvedValue(undefined)
  })

  afterEach(() => {
    if (originalCronSecret === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = originalCronSecret
  })

  it('returns 500 when CRON_SECRET is unset', async () => {
    delete process.env.CRON_SECRET
    const { GET } = await importRoute()

    const res = await GET(request('anything'))

    expect(res.status).toBe(500)
    expect(h.db).not.toHaveBeenCalled()
  })

  it('returns 401 for a missing or wrong secret', async () => {
    const { GET } = await importRoute()

    expect((await GET(request())).status).toBe(401)
    expect((await GET(request('wrong'))).status).toBe(401)
  })

  it('accepts the Authorization: Bearer header and sends every due email for a fresh account', async () => {
    const { GET } = await importRoute()

    const res = await GET(request('test-cron-secret-0123'))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ sent: 4 })
    expect(h.sendTrialEmail).toHaveBeenCalledTimes(4)
  })

  it('skips an account with no resolvable email', async () => {
    rows = [accountRow({ email: null })]
    const { GET } = await importRoute()

    await GET(request('test-cron-secret-0123'))

    expect(h.sendTrialEmail).not.toHaveBeenCalled()
  })

  it('does not resend an email whose bit is already set', async () => {
    rows = [accountRow({ trial_emails_sent: 1 | 2 | 4 | 8 })]
    const { GET } = await importRoute()

    const res = await GET(request('test-cron-secret-0123'))

    expect(await res.json()).toEqual({ sent: 0 })
    expect(h.sendTrialEmail).not.toHaveBeenCalled()
  })

  it('does not touch the bitmask when nothing is due yet', async () => {
    rows = [accountRow({ trial_started_at: new Date(Date.now() - 60_000) })] // day 0
    const { GET } = await importRoute()

    await GET(request('test-cron-secret-0123'))

    const updateCalls = mockSql.mock.calls.filter(([strings]) =>
      (strings as TemplateStringsArray).join('?').includes('UPDATE accounts'),
    )
    expect(updateCalls).toHaveLength(0)
  })

  it('updates the bitmask incrementally, one bit per successful send', async () => {
    rows = [accountRow({ trial_emails_sent: 0 })] // fresh, day 10 -> all 4 due
    const { GET } = await importRoute()

    await GET(request('test-cron-secret-0123'))

    const updateMasks = mockSql.mock.calls
      .filter(([strings]) => (strings as TemplateStringsArray).join('?').includes('UPDATE accounts'))
      .map(([, mask]) => mask)
    // EMAIL_DAY1=1, DAY5=2, DAY7=4, DAY10=8 — each send ORs in its own bit
    // on top of the running mask, so the sequence is 1, 3, 7, 15, not four
    // separate single-bit writes.
    expect(updateMasks).toEqual([1, 3, 7, 15])
  })

  it('continues past one failed send, and still sends the rest — exactly one short', async () => {
    // Both accounts are fresh (day 10, mask 0), so 4 emails are due each: 8
    // attempts total. Only the very first attempt (account-1's day-1 email)
    // is made to fail.
    rows = [accountRow({ id: 'account-1' }), accountRow({ id: 'account-2' })]
    h.sendTrialEmail
      .mockRejectedValueOnce(new Error('Resend down'))
      .mockResolvedValue(undefined)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { GET } = await importRoute()

    const res = await GET(request('test-cron-secret-0123'))

    expect(h.sendTrialEmail).toHaveBeenCalledTimes(8)
    expect(await res.json()).toEqual({ sent: 7 })
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('account-1'),
      expect.any(Error),
    )

    consoleError.mockRestore()
  })

  it('never selects both accounts.id and profiles.id unaliased', async () => {
    const { GET } = await importRoute()
    await GET(request('test-cron-secret-0123'))

    const [selectCall] = mockSql.mock.calls
    const text = (selectCall[0] as TemplateStringsArray).join('?')
    expect(text).toMatch(/select distinct on \(a\.id\)/i)

    // Only the SELECT list matters here — p.id legitimately appears later, in
    // ORDER BY, to break ties deterministically. A regex over the whole query
    // would false-positive on that, so isolate the clause between SELECT and
    // FROM before checking it for a bare p.id.
    const selectClause = text.slice(text.search(/select/i), text.search(/from/i))
    expect(selectClause).not.toMatch(/\bp\.id\b/i)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run __tests__/api/cron/trial-emails.test.ts`
Expected: FAIL — the route still returns 503 `FEATURE_UNAVAILABLE` for every case

- [ ] **Step 3: Restore the route**

Replace the entire contents of `app/api/cron/trial-emails/route.ts`:

```typescript
import { db } from '@/lib/db'
import { appOrigin } from '@/lib/app-origin'
import { sendTrialEmail } from '@/lib/resend'
import { daysSinceTrialStart, pendingTrialEmails } from '@/lib/trial-emails'

export const dynamic = 'force-dynamic'

type TrialAccountRow = {
  id: string
  trial_started_at: string | Date
  trial_emails_sent: number
  email: string | null
}

/**
 * Read the secret, or null when it is missing or too short to be one.
 *
 * Compared against a known-present value, so an unset var can never make an
 * absent header match — this route's pre-fence version compared against
 * `Bearer undefined` and would have accepted that literal string.
 */
function cronSecret(): string | null {
  const secret = process.env.CRON_SECRET
  if (!secret || secret.length < 16) return null
  return secret
}

export async function GET(req: Request) {
  const secret = cronSecret()
  if (!secret) {
    console.error('[cron/trial-emails] CRON_SECRET is unset or shorter than 16 characters')
    return Response.json({ error: 'Server misconfiguration' }, { status: 500 })
  }
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sql = db()
  // Never select both accounts.id and profiles.id unaliased — the Neon HTTP
  // driver builds each row via Object.fromEntries, so two columns sharing an
  // output name silently collide, last one wins. profiles.id is only needed
  // to break ties deterministically in ORDER BY, not in the SELECT list.
  const rows = (await sql`
    SELECT DISTINCT ON (a.id)
      a.id, a.trial_started_at, a.trial_emails_sent, u.email
    FROM accounts a
    JOIN profiles p ON p.account_id = a.id
    LEFT JOIN neon_auth."user" u ON u.id = p.id
    WHERE a.trial_started_at IS NOT NULL
    ORDER BY a.id ASC, p.id ASC
  `) as TrialAccountRow[]

  const appUrl = appOrigin()
  let sent = 0

  for (const row of rows) {
    if (!row.email) continue

    const days = daysSinceTrialStart(row.trial_started_at)
    let mask = Number(row.trial_emails_sent ?? 0)
    const due = pendingTrialEmails(days, mask, appUrl)

    for (const email of due) {
      try {
        await sendTrialEmail({ to: row.email, subject: email.subject, text: email.text })
        mask |= email.bit
        await sql`UPDATE accounts SET trial_emails_sent = ${mask} WHERE id = ${row.id}`
        sent++
      } catch (err) {
        console.error(`[cron/trial-emails] failed to send to account ${row.id}:`, err)
      }
    }
  }

  return Response.json({ sent })
}
```

- [ ] **Step 4: Remove the fenced-routes entry**

In `__tests__/api/fenced-routes.test.ts`, delete this line from the `FENCED` array:

```typescript
  { path: '@/app/api/cron/trial-emails/route', feature: 'trial-emails', methods: ['GET'] },
```

- [ ] **Step 5: Add a maxDuration entry to `vercel.json`**

In `vercel.json`, add `trial-emails` to `functions` (it awaits a Resend send per due email,
serially, per account — the same reason `evaluate-alerts` has this entry despite not calling
an LLM):

```json
{
  "functions": {
    "app/api/scan/route.ts": { "maxDuration": 60 },
    "app/api/fix/route.ts": { "maxDuration": 30 },
    "app/api/pulse/run/route.ts": { "maxDuration": 60 },
    "app/api/cron/pulse/route.ts": { "maxDuration": 60 },
    "app/api/cron/evaluate-alerts/route.ts": { "maxDuration": 60 },
    "app/api/cron/trial-emails/route.ts": { "maxDuration": 60 }
  },
  "crons": [
    { "path": "/api/cron/pulse", "schedule": "17 4 * * 1" },
    { "path": "/api/cron/evaluate-alerts", "schedule": "47 7 * * 1" }
  ]
}
```

(The `crons` array is untouched in this task — it's removed in Task 5, only after the
Cloudflare Worker is built and the runbook says it's verified.)

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run __tests__/api/cron/trial-emails.test.ts __tests__/api/fenced-routes.test.ts`
Expected: PASS

- [ ] **Step 7: Run the full unit suite and typecheck**

Run: `npm run test:unit && npm run typecheck`
Expected: PASS, 0 type errors

- [ ] **Step 8: Commit**

```bash
git add app/api/cron/trial-emails/route.ts __tests__/api/cron/trial-emails.test.ts __tests__/api/fenced-routes.test.ts vercel.json
git commit -m "feat(trial): restore cron/trial-emails, ported to db()"
```

---

### Task 4: `cloudflare/cron-worker/` — the scheduling Worker

**Files:**
- Create: `cloudflare/cron-worker/package.json`
- Create: `cloudflare/cron-worker/wrangler.jsonc`
- Create: `cloudflare/cron-worker/tsconfig.json`
- Create: `cloudflare/cron-worker/vitest.config.ts`
- Create: `cloudflare/cron-worker/src/index.ts`
- Create: `cloudflare/cron-worker/test/scheduled.test.ts`
- Modify: `tsconfig.json` (root — exclude the new package)
- Modify: `vitest.config.ts` (root — exclude the new package)
- Modify: `package.json` (root — exclude the new package from `lint`)
- Modify: `.gitignore` (ignore the new package's `node_modules` and `.wrangler`)

- [ ] **Step 1: Scaffold the package**

```bash
mkdir -p cloudflare/cron-worker/src cloudflare/cron-worker/test
```

Create `cloudflare/cron-worker/package.json`:

```json
{
  "name": "fimmick-aeo-cron-worker",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "tail": "wrangler tail",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4",
    "typescript": "^5",
    "vitest": "^4",
    "wrangler": "^4"
  }
}
```

Create `cloudflare/cron-worker/wrangler.jsonc`:

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "fimmick-aeo-cron-worker",
  "main": "src/index.ts",
  "compatibility_date": "2026-08-22",
  // Matches lib/app-origin.ts's own DEFAULT_APP_ORIGIN fallback, so a fresh
  // deploy works without any extra setup step. Override here (or with
  // `wrangler deploy --var APP_BASE_URL:...`) only when targeting a
  // non-production environment.
  "vars": {
    "APP_BASE_URL": "https://aeo.fimmick.com"
  },
  // Vercel Cron's exact three schedules, moved here because Vercel Hobby caps
  // at 2 crons/day-granularity and Cloudflare's free tier allows 3 per Worker.
  "triggers": {
    "crons": [
      "17 4 * * 1",
      "47 7 * * 1",
      "0 9 * * *"
    ]
  }
}
```

Create `cloudflare/cron-worker/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "es2022",
    "lib": ["es2022"],
    "module": "es2022",
    "moduleResolution": "bundler",
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src", "test"]
}
```

Create `cloudflare/cron-worker/vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
  },
})
```

- [ ] **Step 2: Write the failing tests**

```typescript
// cloudflare/cron-worker/test/scheduled.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import worker, { type Env } from '../src/index'

const env: Env = { CRON_SECRET: 'secret-123', APP_BASE_URL: 'https://app.example.com' }
const ctx = { waitUntil: (p: Promise<unknown>) => p, passThroughOnException: () => {} } as never

function controller(cron: string) {
  return { cron, scheduledTime: Date.now(), type: 'scheduled' as const, noRetry: vi.fn() }
}

describe('scheduled', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    globalThis.fetch = fetchMock as never
  })

  it('calls cron/pulse for the pulse schedule', async () => {
    await worker.scheduled(controller('17 4 * * 1'), env, ctx)

    expect(fetchMock).toHaveBeenCalledWith(
      'https://app.example.com/api/cron/pulse',
      { headers: { Authorization: 'Bearer secret-123' } },
    )
  })

  it('calls cron/evaluate-alerts for the alerts schedule', async () => {
    await worker.scheduled(controller('47 7 * * 1'), env, ctx)

    expect(fetchMock).toHaveBeenCalledWith(
      'https://app.example.com/api/cron/evaluate-alerts',
      { headers: { Authorization: 'Bearer secret-123' } },
    )
  })

  it('calls cron/trial-emails for the trial-emails schedule', async () => {
    await worker.scheduled(controller('0 9 * * *'), env, ctx)

    expect(fetchMock).toHaveBeenCalledWith(
      'https://app.example.com/api/cron/trial-emails',
      { headers: { Authorization: 'Bearer secret-123' } },
    )
  })

  it('throws when the downstream route fails, so Cloudflare retries', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 })

    await expect(worker.scheduled(controller('17 4 * * 1'), env, ctx)).rejects.toThrow()
  })

  it('does nothing for an unmapped cron string', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await worker.scheduled(controller('* * * * *'), env, ctx)

    expect(fetchMock).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })
})
```

- [ ] **Step 3: Install dependencies and run the tests to verify they fail**

```bash
cd cloudflare/cron-worker && npm install
```

Run: `cd cloudflare/cron-worker && npx vitest run`
Expected: FAIL — `Cannot find module '../src/index'`

- [ ] **Step 4: Write the implementation**

```typescript
// cloudflare/cron-worker/src/index.ts
export interface Env {
  CRON_SECRET: string
  APP_BASE_URL: string
}

// The exact three schedules Vercel Cron used to run. Keep this in sync with
// wrangler.jsonc's triggers.crons — each key here must have a matching entry
// there, and __tests__/config/function-durations.test.ts (main repo) pins
// wrangler.jsonc against the routes that actually exist.
const ROUTES: Record<string, string> = {
  '17 4 * * 1': '/api/cron/pulse',
  '47 7 * * 1': '/api/cron/evaluate-alerts',
  '0 9 * * *': '/api/cron/trial-emails',
}

export default {
  async scheduled(controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    const path = ROUTES[controller.cron]
    if (!path) {
      console.error(`[cron-worker] no route mapped for cron "${controller.cron}"`)
      return
    }

    const res = await fetch(`${env.APP_BASE_URL}${path}`, {
      headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
    })

    if (!res.ok) {
      // Throwing lets Cloudflare's automatic retry apply — all three downstream
      // routes are idempotent, so a retry is safe.
      throw new Error(`[cron-worker] ${path} responded ${res.status}`)
    }
  },
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd cloudflare/cron-worker && npx vitest run`
Expected: PASS — 5 tests

- [ ] **Step 6: Run the Worker's own typecheck**

Run: `cd cloudflare/cron-worker && npm run typecheck`
Expected: no errors

- [ ] **Step 7: Exclude the new package from the root project's tooling**

In root `tsconfig.json`, add `"cloudflare"` to `exclude` (it has its own tsconfig and
`@cloudflare/workers-types`, which the Next.js app's compiler options don't include):

```json
  "exclude": [
    "node_modules",
    "__tests__",
    "tests",
    ".worktrees",
    ".codex",
    ".opencode",
    "cloudflare"
  ]
```

In root `vitest.config.ts`, add `'cloudflare/**'` to the `exclude` array (it has its own
`vitest.config.ts` and `@/` resolves differently there):

```typescript
    exclude: ['**/node_modules/**', 'tests/e2e/**', 'e2e/**', '**/.worktrees/**', '**/.superpowers/**', 'cloudflare/**'],
```

In root `package.json`, add an ignore pattern to the `lint` script (matching the existing
`.worktrees`/`.codex`/`.opencode` pattern — this repo's own convention is CLI flags here, not
`eslint.config.mjs`):

```json
    "lint": "eslint . --ignore-pattern \"**/.worktrees/**\" --ignore-pattern \".codex/\" --ignore-pattern \".opencode/\" --ignore-pattern \".claude/\" --ignore-pattern \".superpowers/\" --ignore-pattern \".codebase-memory/**\" --ignore-pattern \"coverage/\" --ignore-pattern \"cloudflare/**\"",
```

In root `.gitignore`, add:

```
/cloudflare/cron-worker/node_modules
/cloudflare/cron-worker/.wrangler
```

- [ ] **Step 8: Run the root suite to confirm the exclusions work and nothing else broke**

Run: `npm run test:unit && npm run lint && npm run typecheck`
Expected: PASS — same counts as before this task; no attempt to run or typecheck anything
under `cloudflare/`

- [ ] **Step 9: Commit**

```bash
git add cloudflare/ tsconfig.json vitest.config.ts package.json .gitignore
git commit -m "feat(cron): add the Cloudflare Worker that schedules pulse, evaluate-alerts, and trial-emails"
```

---

### Task 5: Cut Vercel Cron over to the Worker

**Files:**
- Modify: `vercel.json` (remove `crons`)
- Modify: `__tests__/config/function-durations.test.ts`

- [ ] **Step 1: Update the failing test first**

Replace the three tests in `__tests__/config/function-durations.test.ts` that reference
`config.crons` — `'schedules the Pulse driver, and every cron path is a route that exists'`,
`'evaluates alerts after the rollup they read, on the same day'`, and
`'keeps the schedule inside what a Hobby project can actually run'` — with tests against the
Worker's `wrangler.jsonc` instead. Replace the whole file's contents:

```typescript
// __tests__/config/function-durations.test.ts
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

type VercelConfig = {
  functions?: Record<string, { maxDuration?: number }>
}

type WranglerConfig = {
  triggers?: { crons?: string[] }
}

const config = JSON.parse(
  readFileSync(join(process.cwd(), 'vercel.json'), 'utf8'),
) as VercelConfig

// wrangler.jsonc allows `//` comments, which JSON.parse rejects — strip them
// before parsing. Only strips a `//` that starts a line (after whitespace) or
// follows a comma/brace, so it can't misfire inside a string value like a URL.
function parseWranglerJsonc(raw: string): WranglerConfig {
  const withoutComments = raw.replace(/^\s*\/\/.*$/gm, '')
  return JSON.parse(withoutComments) as WranglerConfig
}

const workerConfig = parseWranglerJsonc(
  readFileSync(join(process.cwd(), 'cloudflare/cron-worker/wrangler.jsonc'), 'utf8'),
)

/**
 * Every route that fans out to an LLM needs a declared maxDuration, because the
 * platform default (10s Hobby / 15s Pro) is far below what one of these costs.
 * A missing key is silent — the route deploys and then times out mid-work —
 * which is exactly how /api/pulse/run shipped unable to finish a single prompt.
 *
 * The `functions` keys are literal paths, not prefixes: `fix/` subroutes inherit
 * nothing from `app/api/fix/route.ts` despite also calling OpenRouter.
 */
const LLM_ROUTES = [
  'app/api/scan/route.ts',
  'app/api/fix/route.ts',
  'app/api/pulse/run/route.ts',
  // Not an LLM caller itself, but it awaits one, so it needs the same headroom.
  'app/api/cron/pulse/route.ts',
  // Not an LLM caller either — it awaits a Resend send per fired alert, serially.
  'app/api/cron/evaluate-alerts/route.ts',
  // Same shape as evaluate-alerts: a Resend send per due email, serially.
  'app/api/cron/trial-emails/route.ts',
]

describe('Vercel function durations', () => {
  it.each(LLM_ROUTES)('%s declares a maxDuration', (route) => {
    expect(config.functions?.[route]?.maxDuration).toBeTypeOf('number')
  })

  it('keeps every declared duration inside the Hobby ceiling', () => {
    // 60s is the Hobby maximum. Staying under it means the config needs no
    // assumption about which plan the project is on.
    for (const [route, fn] of Object.entries(config.functions ?? {})) {
      expect(fn.maxDuration, `${route} exceeds the 60s Hobby ceiling`)
        .toBeLessThanOrEqual(60)
    }
  })

  it('no longer schedules anything from vercel.json — Cloudflare owns that now', () => {
    expect((config as { crons?: unknown[] }).crons ?? []).toEqual([])
  })
})

describe('Cloudflare cron-worker schedule', () => {
  it('schedules exactly the three cron routes, and every one exists', () => {
    expect(workerConfig.triggers?.crons).toEqual([
      '17 4 * * 1',
      '47 7 * * 1',
      '0 9 * * *',
    ])

    const paths = ['/api/cron/pulse', '/api/cron/evaluate-alerts', '/api/cron/trial-emails']
    for (const path of paths) {
      const route = join(process.cwd(), 'app', `${path}/route.ts`)
      expect(existsSync(route), `${path} has no route file`).toBe(true)
      // The Worker calls with GET, mirroring what Vercel Cron used to send.
      expect(readFileSync(route, 'utf8')).toMatch(/export async function GET\b/)
    }
  })

  it('evaluates alerts after the rollup they read, on the same day', () => {
    // Alerts compare the latest two aggregate weeks. Run before the week's
    // rollup lands and the comparison is last week against the week before --
    // it would not error, it would just be quietly a week stale, every week.
    const at = (schedule: string) => {
      const [minute, hour, , , weekday] = schedule.split(' ')
      return { weekday, minutes: Number(hour) * 60 + Number(minute) }
    }

    const crons = workerConfig.triggers?.crons ?? []
    const pulse = at(crons[0])
    const alerts = at(crons[1])

    expect(alerts.weekday).toBe(pulse.weekday)
    expect(alerts.minutes).toBeGreaterThan(pulse.minutes)
  })

  it('stays within the Cloudflare free tier of 3 triggers per Worker', () => {
    expect(workerConfig.triggers?.crons?.length ?? 0).toBeLessThanOrEqual(3)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/config/function-durations.test.ts`
Expected: FAIL — `'no longer schedules anything from vercel.json'` fails, because `vercel.json`
still has its `crons` array

- [ ] **Step 3: Remove `vercel.json`'s `crons` array**

Replace `vercel.json`'s contents:

```json
{
  "functions": {
    "app/api/scan/route.ts": { "maxDuration": 60 },
    "app/api/fix/route.ts": { "maxDuration": 30 },
    "app/api/pulse/run/route.ts": { "maxDuration": 60 },
    "app/api/cron/pulse/route.ts": { "maxDuration": 60 },
    "app/api/cron/evaluate-alerts/route.ts": { "maxDuration": 60 },
    "app/api/cron/trial-emails/route.ts": { "maxDuration": 60 }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run __tests__/config/function-durations.test.ts`
Expected: PASS — all tests, both `describe` blocks

- [ ] **Step 5: Run the full unit suite**

Run: `npm run test:unit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add vercel.json __tests__/config/function-durations.test.ts
git commit -m "refactor(cron): stop scheduling from vercel.json now the Cloudflare Worker does"
```

---

### Task 6: Deployment runbook

**Files:**
- Create: `docs/runbooks/deploy-cron-worker.md`

- [ ] **Step 1: Write the runbook**

```markdown
# Runbook: deploy the cron-triggering Cloudflare Worker

**When to run this:** after `cloudflare/cron-worker/` is merged, to actually start
scheduling `cron/pulse`, `cron/evaluate-alerts`, and `cron/trial-emails` from
Cloudflare instead of Vercel.

**Who runs it:** a human with access to this project's Cloudflare account and
the Vercel project's `CRON_SECRET` value. An agent must not read or type the
secret — copy it directly between your password manager / Vercel's dashboard
and the command below.

## Procedure

1. **Install dependencies**, if not already done:

       cd cloudflare/cron-worker && npm install

2. **Authenticate wrangler**, if this machine hasn't before:

       npx wrangler login

3. **Set the secret** — the exact same value as Vercel's `CRON_SECRET` env var,
   copied directly (never through a shell history-visible `export`):

       npx wrangler secret put CRON_SECRET

   Paste the value when prompted; it is not echoed.

4. **`APP_BASE_URL`** already defaults to `https://aeo.fimmick.com` in
   `wrangler.jsonc`'s `vars`, matching `lib/app-origin.ts`'s own fallback — no
   action needed unless you're deploying against a different environment, in
   which case edit that `vars` entry (or pass `--var APP_BASE_URL:...` to
   `wrangler deploy`) and commit the change if it's meant to be permanent.

5. **Deploy:**

       npx wrangler deploy

6. **Verify**, allowing up to 15 minutes for global propagation:
   - Cloudflare dashboard → Workers & Pages → `fimmick-aeo-cron-worker` →
     Triggers → Cron Events, or `npx wrangler tail` while a schedule fires.
   - Confirm each of the three schedules produces a `2xx` from its Vercel
     route. A `401` means `CRON_SECRET` doesn't match; a network error means
     `APP_BASE_URL` is wrong.

7. **Only once verified**, remove `vercel.json`'s `crons` array (already done
   in this branch's own commits) and confirm the removal is deployed on
   Vercel too, so Vercel stops attempting to schedule these routes.

## Rollback

The three Vercel routes are unchanged and still accept the exact request
shape Vercel Cron used to send. If the Worker misbehaves, restore
`vercel.json`'s `crons` array:

    "crons": [
      { "path": "/api/cron/pulse", "schedule": "17 4 * * 1" },
      { "path": "/api/cron/evaluate-alerts", "schedule": "47 7 * * 1" }
    ]

(`trial-emails` was never in that array historically before this branch, so
its Vercel Hobby-plan rollback would need Cloudflare kept running for it
alone, or trial-emails paused, since Hobby can't hold all 3.)

No route code needs to change either way.
```

- [ ] **Step 2: Commit**

```bash
git add docs/runbooks/deploy-cron-worker.md
git commit -m "docs: runbook for deploying the cron-scheduling Cloudflare Worker"
```
