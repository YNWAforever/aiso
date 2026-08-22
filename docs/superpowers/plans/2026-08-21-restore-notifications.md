# Restore Notifications (Roadmap N4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the fenced `notifications/*` routes and make the in-app notification bell reachable, so alerts the live evaluator already writes to the `notifications` table have a working in-app counterpart instead of a permanently fenced dead end.

**Architecture:** Two API routes are ported from their pre-fence Supabase implementation (recovered from git history) onto `db()`, following the exact `getProfile()` → account-scoped query pattern already established in `app/api/dashboard/clients/[clientId]/alerts/route.ts`. `NotificationBell.tsx` — a fully built, currently-unmounted component — gets restyled from hardcoded colors onto this codebase's semantic theme tokens (it predates the dark/light redesign) and mounted in a new thin header row in the shared dashboard layout, which already resolves the profile needed to compute its unread badge count.

**Tech Stack:** TypeScript 5.9, Next.js 16 route handlers, Neon Postgres (`@neondatabase/serverless` via `db()`), Vitest 4, React Server Components.

**Design doc:** `docs/superpowers/specs/2026-08-21-restore-notifications-design.md` — read it first if anything below is unclear about *why*; this plan covers *how*.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `app/api/notifications/route.ts` | `GET` — the caller's 20 most recent notifications | Modify (currently a fence stub) |
| `app/api/notifications/read-all/route.ts` | `PUT` — marks all the caller's unread notifications read | Modify (currently a fence stub) |
| `__tests__/api/notifications.test.ts` | Covers the GET route | Create |
| `__tests__/api/notifications-read-all.test.ts` | Covers the PUT route | Create |
| `__tests__/api/fenced-routes.test.ts` | Canonical fenced-route list | Modify (remove 2 entries) |
| `CLAUDE.md` | Auth Architecture section's fenced-route list and restore-vs-delete note | Modify |
| `components/dashboard/NotificationBell.tsx` | The bell + dropdown UI | Modify (hardcoded colors → semantic tokens) |
| `app/[lang]/dashboard/layout.tsx` | Shared dashboard shell | Modify (new header row, unread count query) |
| `__tests__/dashboard-layout-entitlement.test.tsx` | Covers the dashboard layout | Modify (extend the existing `db` mock, add bell-wiring tests) |

**Commands** (from the repo root):

```bash
npx vitest run __tests__/path/to/file.test.ts
```

```bash
npm run lint && npm run typecheck
```

Baseline before this plan: run `npm run test:unit` and record the file/test counts before Task 1 — subsequent tasks report deltas against that baseline. Do not use `npm test` in this worktree; it fails on an empty `node_modules` unrelated to this plan (`scripts/run-tests.mjs` cannot resolve `vitest` from its own directory). `npm run test:unit` works correctly.

---

### Task 1: Restore `GET /api/notifications`

**Files:**
- Modify: `app/api/notifications/route.ts`
- Create: `__tests__/api/notifications.test.ts`

The current file is a fence stub:

```ts
import { featureUnavailable } from '@/lib/unavailable'

// Fenced during the Supabase to Neon migration. The Supabase implementation is
// in git history at the parent of this commit. Restoring it means porting the
// queries to db(), not reviving code that targets a deleted project.
export async function GET() {
  return featureUnavailable('notifications')
}
```

- [ ] **Step 1: Write the failing test**

Create `__tests__/api/notifications.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const queries: string[] = []
const params: unknown[][] = []
let nextResults: unknown[] = []

const mockSql = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
  queries.push(strings.join('?'))
  params.push(values)
  const result = nextResults.shift()
  if (result instanceof Error) throw result
  return Promise.resolve(result ?? [])
})
vi.mock('@/lib/db', () => ({ db: () => mockSql }))
vi.mock('@/lib/auth', () => ({ getProfile: vi.fn() }))

import { GET } from '@/app/api/notifications/route'
import { getProfile } from '@/lib/auth'

const PROFILE = { account_id: 'acc-1' } as never

beforeEach(() => {
  queries.length = 0
  params.length = 0
  nextResults = []
  vi.mocked(getProfile).mockReset()
})

describe('GET /api/notifications', () => {
  it('returns 401 without touching the database', async () => {
    vi.mocked(getProfile).mockResolvedValue(null)

    const res = await GET()

    expect(res.status).toBe(401)
    expect(queries).toHaveLength(0)
  })

  it('returns the caller\'s notifications, most recent first', async () => {
    vi.mocked(getProfile).mockResolvedValue(PROFILE)
    const rows = [
      { id: 'n-2', account_id: 'acc-1', title: 'Newer', created_at: '2026-08-20T00:00:00.000Z' },
      { id: 'n-1', account_id: 'acc-1', title: 'Older', created_at: '2026-08-01T00:00:00.000Z' },
    ]
    nextResults = [rows]

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.notifications).toEqual(rows)
  })

  it('scopes the query to the caller\'s account_id', async () => {
    vi.mocked(getProfile).mockResolvedValue(PROFILE)
    nextResults = [[]]

    await GET()

    expect(queries[0]).toContain('from notifications')
    expect(queries[0]).toContain('account_id')
    expect(params[0]).toContain('acc-1')
  })

  it('returns an empty array when the account has no notifications', async () => {
    vi.mocked(getProfile).mockResolvedValue(PROFILE)
    nextResults = [[]]

    const body = await (await GET()).json()

    expect(body.notifications).toEqual([])
  })

  it('returns 503 rather than a misleading empty list when the query throws', async () => {
    vi.mocked(getProfile).mockResolvedValue(PROFILE)
    nextResults = [new Error('connection terminated')]

    expect((await GET()).status).toBe(503)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run __tests__/api/notifications.test.ts`

Expected: the first test (401) currently passes by accident — the fence stub also returns a non-200 status, but it returns 503 with `{error: 'FEATURE_UNAVAILABLE', ...}`, not 401, so that test FAILS too. All 5 tests FAIL: the fence stub takes no arguments matching this shape, never touches `getProfile` or `db()`, and always returns 503 regardless of auth state.

- [ ] **Step 3: Implement the route**

Replace `app/api/notifications/route.ts`:

```ts
import { getProfile } from '@/lib/auth'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  const profile = await getProfile()
  if (!profile) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const notifications = await db()`
      select * from notifications
      where account_id = ${profile.account_id}
      order by created_at desc
      limit 20
    `
    return Response.json({ notifications })
  } catch {
    return Response.json({ error: 'Notification lookup failed' }, { status: 503 })
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run __tests__/api/notifications.test.ts`

Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add app/api/notifications/route.ts __tests__/api/notifications.test.ts
git commit -m "feat(notifications): restore GET /api/notifications"
```

---

### Task 2: Restore `PUT /api/notifications/read-all`

**Files:**
- Modify: `app/api/notifications/read-all/route.ts`
- Create: `__tests__/api/notifications-read-all.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/api/notifications-read-all.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const queries: string[] = []
const params: unknown[][] = []
let nextResults: unknown[] = []

const mockSql = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
  queries.push(strings.join('?'))
  params.push(values)
  const result = nextResults.shift()
  if (result instanceof Error) throw result
  return Promise.resolve(result ?? [])
})
vi.mock('@/lib/db', () => ({ db: () => mockSql }))
vi.mock('@/lib/auth', () => ({ getProfile: vi.fn() }))

import { PUT } from '@/app/api/notifications/read-all/route'
import { getProfile } from '@/lib/auth'

const PROFILE = { account_id: 'acc-1' } as never

beforeEach(() => {
  queries.length = 0
  params.length = 0
  nextResults = []
  vi.mocked(getProfile).mockReset()
})

describe('PUT /api/notifications/read-all', () => {
  it('returns 401 without touching the database', async () => {
    vi.mocked(getProfile).mockResolvedValue(null)

    const res = await PUT()

    expect(res.status).toBe(401)
    expect(queries).toHaveLength(0)
  })

  it('marks only the caller\'s unread notifications read', async () => {
    vi.mocked(getProfile).mockResolvedValue(PROFILE)
    nextResults = [[]]

    await PUT()

    expect(queries[0]).toContain('update notifications')
    expect(queries[0]).toContain('account_id')
    expect(queries[0]).toContain('read')
    expect(params[0]).toContain('acc-1')
    expect(params[0]).toContain(false)
  })

  it('returns ok on success', async () => {
    vi.mocked(getProfile).mockResolvedValue(PROFILE)
    nextResults = [[]]

    const body = await (await PUT()).json()

    expect(body).toEqual({ ok: true })
  })

  it('returns 500, never a 2xx, when the write throws', async () => {
    vi.mocked(getProfile).mockResolvedValue(PROFILE)
    nextResults = [new Error('connection terminated')]

    expect((await PUT()).status).toBe(500)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run __tests__/api/notifications-read-all.test.ts`

Expected: FAIL — same reason as Task 1: the fence stub takes no request argument and always returns 503.

- [ ] **Step 3: Implement the route**

Replace `app/api/notifications/read-all/route.ts`:

```ts
import { getProfile } from '@/lib/auth'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function PUT() {
  const profile = await getProfile()
  if (!profile) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await db()`
      update notifications
      set read = ${true}
      where account_id = ${profile.account_id} and read = ${false}
    `
    return Response.json({ ok: true })
  } catch {
    return Response.json({ error: 'Failed to mark notifications read' }, { status: 500 })
  }
}
```

Both booleans are interpolated as parameters rather than written as SQL literals — matching the convention already used in `app/api/dashboard/clients/[clientId]/alerts/route.ts` (`${Boolean(body.enabled_sov)}`), and it's what Step 1's test asserts against.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run __tests__/api/notifications-read-all.test.ts`

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add app/api/notifications/read-all/route.ts __tests__/api/notifications-read-all.test.ts
git commit -m "feat(notifications): restore PUT /api/notifications/read-all"
```

---

### Task 3: Remove the fence and settle the docs

**Files:**
- Modify: `__tests__/api/fenced-routes.test.ts`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Remove the two entries from the canonical fenced-route list**

In `__tests__/api/fenced-routes.test.ts`, delete these two lines from the `FENCED` array:

```ts
  { path: '@/app/api/notifications/route', feature: 'notifications', methods: ['GET'] },
  { path: '@/app/api/notifications/read-all/route', feature: 'notifications', methods: ['PUT'] },
```

- [ ] **Step 2: Run the fence test to verify it still passes**

Run: `npx vitest run __tests__/api/fenced-routes.test.ts`

Expected: PASS. This file no longer asserts anything about `notifications/*` — Tasks 1 and 2's own tests are what now cover those routes' real behavior.

- [ ] **Step 3: Update CLAUDE.md's fenced-routes list**

In `CLAUDE.md`, find this block (Auth Architecture section):

```markdown
> Routes whose feature is fenced return `503 FEATURE_UNAVAILABLE` via `lib/unavailable.ts`:
> `pulse/onboard`, `pulse/[clientId]/*`, `fix/cluster-map`, `fix/content-brief`,
> `notifications/*`, `agents/*`, `cron/trial-emails`. **Local
> Trust, the alerts *config* route, the Pulse producer (`pulse/run`), the whole prompt bank
> and `pulse/suggest-questions` are restored**. `cron/evaluate-alerts` is now Neon-backed
```

Replace it with:

```markdown
> Routes whose feature is fenced return `503 FEATURE_UNAVAILABLE` via `lib/unavailable.ts`:
> `pulse/onboard`, `pulse/[clientId]/*`, `fix/cluster-map`, `fix/content-brief`,
> `agents/*`, `cron/trial-emails`. **Local
> Trust, the alerts *config* route, `notifications/*`, the Pulse producer (`pulse/run`), the
> whole prompt bank and `pulse/suggest-questions` are restored**. `cron/evaluate-alerts` is now Neon-backed
```

- [ ] **Step 4: Settle the restore-vs-delete note**

In the same file, find:

```markdown
> `notifications/*` **used to be a fourth**, on the grounds that no producer had ever written
> that table. **That rationale expired**: alert evaluation writes it now (`upsertNotification`
> in `lib/alerts/neon-store.ts`, deduped by `033`'s unique index on
> `(client_id, type, scan_week)`), so restore-vs-delete needs deciding on the new facts
> rather than inheriting the old conclusion. Its only consumer, `NotificationBell`, still has
> no importer.
```

Replace it with:

```markdown
> `notifications/*` **was restored, not deleted** (2026-08-21): it used to be a fourth fence,
> on the grounds that no producer had ever written that table, but that rationale expired once
> alert evaluation started writing it (`upsertNotification` in `lib/alerts/neon-store.ts`,
> deduped by `033`'s unique index on `(client_id, type, scan_week)`). `NotificationBell` is
> mounted in `app/[lang]/dashboard/layout.tsx`'s header row, so it has an importer now.
```

- [ ] **Step 5: Commit**

```bash
git add __tests__/api/fenced-routes.test.ts CLAUDE.md
git commit -m "docs(notifications): remove the fence entry and settle restore-vs-delete"
```

---

### Task 4: Restyle `NotificationBell` onto semantic theme tokens

**Files:**
- Modify: `components/dashboard/NotificationBell.tsx`

No behavioral change in this task — same dropdown structure, same `TYPE_ICON` map, same click-outside-to-close handler, same `router.refresh()` after mark-all-read. Only the Tailwind classes change, from hardcoded colors (this component predates the dashboard's dark/light theme redesign) to the semantic tokens already defined in `app/globals.css` and used elsewhere in `components/dashboard/`.

This task has no test of its own — it is a pure styling change to a component Task 5 will cover with rendering/wiring tests. Read the current file before editing (it was last shown in full during design, but read it fresh here since this plan may run standalone).

- [ ] **Step 1: Read the current file**

Read `components/dashboard/NotificationBell.tsx` in full and confirm its structure matches what's described below before editing — report any difference.

- [ ] **Step 2: Replace the hardcoded color classes**

Apply these exact substitutions (all other classes, structure, and logic stay unchanged):

| Find | Replace with | Where |
|---|---|---|
| `bg-white` | `bg-popover` | dropdown panel `<div>` |
| `border-slate-200` | `border-border` | dropdown panel `<div>` |
| `border-slate-100` | `border-border` | header row's bottom border |
| `text-slate-800` | `text-popover-foreground` | "Notifications" header text, and each notification's title `<p>` |
| `text-slate-500` | `text-muted-foreground` | each notification's message `<p>`, and the bell icon button's default state |
| `text-slate-400` | `text-muted-foreground` | timestamp `<p>`, and the "No notifications yet." / "Loading…" empty state |
| `hover:text-slate-800` | `hover:text-foreground` | bell icon button's hover state |
| `bg-blue-50` | `bg-primary/10` | unread notification row background |
| `text-blue-600` | `text-primary` | "Mark all read" link |
| `hover:text-blue-700` | `hover:text-primary-accessible` | "Mark all read" link hover state |
| `bg-red-500` | `bg-destructive` | unread count badge |
| `text-white` | `text-destructive-foreground` | unread count badge text |

- [ ] **Step 3: Verify no hardcoded colors remain**

Run:

```bash
grep -oE "bg-white|text-slate-[0-9]+|border-slate-[0-9]+|bg-blue-[0-9]+|text-blue-[0-9]+|bg-red-[0-9]+" components/dashboard/NotificationBell.tsx
```

Expected: no output.

- [ ] **Step 4: Run the full unit suite and lint**

```bash
npm run test:unit
npm run lint
npm run typecheck
```

Expected: no new failures. This file has no dedicated test yet (Task 5 adds one), so nothing should change in the counts from Task 3's baseline.

- [ ] **Step 5: Commit**

```bash
git add components/dashboard/NotificationBell.tsx
git commit -m "style(notifications): move NotificationBell onto semantic theme tokens"
```

---

### Task 5: Mount the bell in the dashboard layout

**Files:**
- Modify: `app/[lang]/dashboard/layout.tsx`
- Modify: `__tests__/dashboard-layout-entitlement.test.tsx`

**Read this before starting:** `__tests__/dashboard-layout-entitlement.test.tsx` currently contains:

```ts
vi.mock('@/lib/db', () => ({ db: vi.fn(() => { throw new Error('unexpected db access') }) }))
```

This asserts the layout never touches the database — true today, false after this task. Step 1 replaces this with a controllable mock (verified working in this exact double-`vi.hoisted` shape below — do not substitute a different hoisting pattern without re-verifying it against Vitest's actual hoisting order, which only hoists `vi.mock()` calls above imports, not arbitrary variable declarations above each other).

- [ ] **Step 1: Update the test file's `db` mock and add a `findElementOfType` helper**

Read `__tests__/dashboard-layout-entitlement.test.tsx` in full first (it was last shown during planning; confirm it still matches before editing).

Replace the top of the file — everything from the `vi.hoisted` block through the `vi.mock` calls — with:

```ts
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const dbNextResults = vi.hoisted((): unknown[] => [])
const { requireAuthMock, headersMock, dbMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  headersMock: vi.fn(),
  dbMock: vi.fn(() => {
    const result = dbNextResults.shift()
    if (result instanceof Error) throw result
    return Promise.resolve(result ?? [])
  }),
}))

vi.mock('@/lib/auth', () => ({ requireAuth: requireAuthMock }))
vi.mock('next/headers', () => ({ headers: headersMock }))
vi.mock('@/lib/db', () => ({ db: () => dbMock }))
vi.mock('@/components/dashboard/DashboardSidebar', () => ({
  DashboardSidebar: () => null,
}))
vi.mock('@/components/dashboard/TrialBanner', () => ({
  TrialBanner: () => null,
}))
vi.mock('@/components/dashboard/NotificationBell', () => ({
  NotificationBell: () => null,
}))

import DashboardLayout from '@/app/[lang]/dashboard/layout'
import { TrialBanner } from '@/components/dashboard/TrialBanner'
import { NotificationBell } from '@/components/dashboard/NotificationBell'
```

Below the existing `TrialBannerProps` type and `account()` helper, replace the single-purpose `findTrialBanner` function with a generalized version reusable for both components (both existing and new callers need the exact same tree-walk):

```ts
function findElementOfType<P>(node: ReactNode, type: unknown): ReactElement<P> | undefined {
  if (!isValidElement(node)) return undefined
  if (node.type === type) return node as ReactElement<P>

  const props = node.props as { children?: ReactNode }
  for (const child of Children.toArray(props.children)) {
    const found = findElementOfType<P>(child, type)
    if (found) return found
  }
  return undefined
}
```

Delete the old `findTrialBanner` function entirely. Update every existing call site in the file from `findTrialBanner(layout)` to `findElementOfType<TrialBannerProps>(layout, TrialBanner)`.

In `beforeEach`, add the two new lines:

```ts
  beforeEach(() => {
    vi.clearAllMocks()
    headersMock.mockResolvedValue(new Headers())
    dbNextResults.length = 0
  })
```

- [ ] **Step 2: Run the existing tests to confirm nothing broke**

Run: `npx vitest run __tests__/dashboard-layout-entitlement.test.tsx`

Expected: PASS, all 7 pre-existing tests (the trial banner ones). Each call to `renderLayout()` now triggers a `db()` call for the unread count that this task's Step 3 will add to the layout — but until Step 3 lands, the layout doesn't call `db()` at all yet, so this step should already be green with the mock alone in place. If it fails here, stop: something about the file no longer matches what Step 1 assumed, and the mismatch needs resolving before continuing.

- [ ] **Step 3: Write the two new failing tests**

Add a new `describe` block to the end of the file:

```ts
describe('dashboard notification bell', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    headersMock.mockResolvedValue(new Headers())
    dbNextResults.length = 0
  })

  it('passes the unread count to the bell', async () => {
    dbNextResults.push([{ n: 3 }])

    const layout = await renderLayout(account())
    const bell = findElementOfType<{ initialCount: number }>(layout, NotificationBell)

    expect(bell).toBeDefined()
    expect(bell?.props.initialCount).toBe(3)
  })

  it('degrades to a zero count rather than failing the page when the query throws', async () => {
    dbNextResults.push(new Error('connection terminated'))

    const layout = await renderLayout(account())
    const bell = findElementOfType<{ initialCount: number }>(layout, NotificationBell)

    expect(bell).toBeDefined()
    expect(bell?.props.initialCount).toBe(0)
  })
})
```

- [ ] **Step 4: Run it to verify it fails**

Run: `npx vitest run __tests__/dashboard-layout-entitlement.test.tsx`

Expected: the two new tests FAIL (`findElementOfType(...)` returns `undefined` — the layout does not render `NotificationBell` at all yet). The 7 pre-existing tests still PASS.

- [ ] **Step 5: Implement the layout change**

Replace `app/[lang]/dashboard/layout.tsx`:

```ts
import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import { DashboardSidebar } from '@/components/dashboard/DashboardSidebar'
import { TrialBanner } from '@/components/dashboard/TrialBanner'
import { NotificationBell } from '@/components/dashboard/NotificationBell'
import { getTrialStatus } from '@/lib/trial'
import { resolveCommercialEntitlement } from '@/lib/tier'

export default async function DashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ lang: string }>
}) {
  const { lang } = await params
  const profile = await requireAuth(lang)
  const trial = getTrialStatus(profile.accounts)
  const entitlement = resolveCommercialEntitlement(profile.accounts)

  // The brand is deliberately NOT resolved here. This layout sits at
  // `dashboard/`, so it cannot see the `[clientId]` segment's params — a Next
  // limitation, not an oversight. It used to reach for an `x-invoke-path`
  // header instead, which Next 13 set and Next 16 does not; nothing in the app
  // or the framework sets it, so the match never fired, brandName was always
  // undefined, and the brand chip never rendered once. DashboardSidebar reads
  // the id from useParams instead, which works because it renders inside the
  // route rather than above it.

  let unreadCount = 0
  try {
    const rows = await db()`
      select count(*)::int as n from notifications
      where account_id = ${profile.account_id} and read = false
    `
    unreadCount = rows[0]?.n ?? 0
  } catch {
    // non-critical -- the bell shows 0 rather than breaking the page
  }

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden">
      {entitlement.source === 'trial' && trial.isTrial && !trial.isExpired && (
        <TrialBanner daysRemaining={trial.daysRemaining} lang={lang} />
      )}
      <div className="flex flex-1 overflow-hidden">
        <DashboardSidebar profile={profile} entitlement={entitlement} />
        <div className="flex-1 flex flex-col overflow-auto">
          <header className="flex justify-end px-6 py-3 border-b border-border">
            <NotificationBell initialCount={unreadCount} />
          </header>
          {children}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Run it to verify it passes**

Run: `npx vitest run __tests__/dashboard-layout-entitlement.test.tsx`

Expected: PASS, all 9 tests (7 pre-existing + 2 new).

- [ ] **Step 7: Full verification**

```bash
npm run test:unit
npm run lint
npm run typecheck
```

Expected: lint 0 errors / 0 warnings, typecheck exit 0, unit suite fully green. Report the file/test counts and compare against the baseline recorded before Task 1 — this plan adds exactly 2 new test files (Tasks 1 and 2) and 2 new tests to an existing file (Task 5), so the delta should be `+2 files`, and the test-count delta should be `5 (Task 1) + 4 (Task 2) + 2 (Task 5) = 11`.

- [ ] **Step 8: Commit**

```bash
git add "app/[lang]/dashboard/layout.tsx" __tests__/dashboard-layout-entitlement.test.tsx
git commit -m "feat(notifications): mount NotificationBell in the dashboard layout"
```

---

## What this plan deliberately does not do

- **Does not resurrect `TopBar`'s `{ title, subtitle }` props.** Nothing currently needs page titles rendered in shared chrome; that is a separate, unrelated decision from restoring notifications.
- **Does not add brand/client name display to notification rows.** The alert title text already embeds it (`"SoV Alert — Acme"`, from `buildAction` in `lib/alerts/evaluate.ts`), so the information already reaches the user without a schema join or additional UI.
- **Does not add pagination beyond the existing `limit 20`.** Unchanged from the pre-fence implementation; the dropdown was never a full inbox.
- **Does not touch `DashboardSidebar.tsx`.** The bell mounts in a new header row in the shared layout, not inside the sidebar.
- **Does not add an integration test.** This is CRUD against a table whose schema (`033`, `036`) is already integration-tested elsewhere; unit-level mocks are sufficient, consistent with the sibling `alerts-config.test.ts`'s own scope for a structurally identical route.
