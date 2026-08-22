# Restore Notifications (Roadmap N4) Design

**Goal:** Restore the fenced `notifications/*` routes and make the in-app notification bell reachable again, so the alert emails the live evaluator sends already have an in-app counterpart instead of a permanently-fenced dead end.

**Context:** `runAlertEvaluation` (hardened in [YNWAforever/fimmick-aeo#49](https://github.com/YNWAforever/fimmick-aeo/pull/49)) already writes to `public.notifications` via `upsertNotification`, deduped by `033`'s unique index on `(client_id, type, scan_week)`. `036` disabled RLS on the table (it carried a dead Supabase-era policy calling `auth.uid()`, a function that does not exist under Neon), so — per this codebase's core rule — every query against it must filter by `account_id` explicitly in application code; there is no database backstop.

The routes and the UI component both already exist in full, working form — they were built once (`e9f1d6b`), then fenced with a `featureUnavailable('notifications')` stub during the Supabase→Neon migration (`71abd27`), and their original host component, `TopBar.tsx`, was deleted outright as orphaned Supabase-era dead code (`7b0cb9d`) rather than migrated. This is a restoration with full source history to work from, not new design — the only genuinely open question was where the bell should live now that its host is gone.

---

## 1. API routes

Both routes port directly from the pre-fence implementation (recovered from git history at `71abd27^`), swapped from the Supabase client onto `db()`. No entitlement gate on either — reading or clearing your own notification inbox is not a paid capability, matching the existing precedent at `app/api/dashboard/clients/[clientId]/alerts/route.ts:48-50`, whose GET is deliberately auth-only. Both are account-scoped only; `client_id` is never part of the filter, on either the read or the write.

### `app/api/notifications/route.ts`

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

`limit 20` matches the original. The dropdown is a fixed-height (`max-h-80`), scrollable popover, not a paginated inbox — 20 rows was never a product constraint that changed, just a sane bound on an unbounded-growth table.

### `app/api/notifications/read-all/route.ts`

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
      set read = true
      where account_id = ${profile.account_id} and read = false
    `
    return Response.json({ ok: true })
  } catch {
    return Response.json({ error: 'Failed to mark notifications read' }, { status: 500 })
  }
}
```

A thrown query error propagates via `catch` to a 5xx in both routes — no swallowed-`error` object to port over from the old `{ data, error }` Supabase shape, and no risk of the "return 200 over a dead write" failure mode CLAUDE.md warns about, since `db()` throws rather than returning a sentinel.

---

## 2. UI: mounting and styling

### Mounting

A thin header row is added to `app/[lang]/dashboard/layout.tsx`, above `{children}`, containing only the bell — no page title or subtitle. `TopBar`'s original `{ title, subtitle }` props are not resurrected: nothing in the current dashboard supplies page titles to a shared header, and reintroducing that plumbing is out of scope for restoring notifications.

The layout already resolves `profile` via `requireAuth(lang)` for every dashboard page, so computing the unread badge count costs one additional query with zero new auth plumbing:

```ts
let unreadCount = 0
try {
  const rows = await db()`
    select count(*)::int as n from notifications
    where account_id = ${profile.account_id} and read = false
  `
  unreadCount = rows[0]?.n ?? 0
} catch {
  // non-critical — bell shows 0 rather than breaking the page
}
```

This mirrors the original `TopBar`'s degrade-on-failure contract exactly: a count-query failure must not take down dashboard navigation.

`<NotificationBell initialCount={unreadCount} />` is rendered right-aligned in the new header row. `DashboardSidebar` itself is not touched — it does not currently receive `unreadCount`, and there is no reason to route this prop through it just to reach a header row above `{children}`.

### Styling fix

`NotificationBell.tsx` has not been touched since April, before the dashboard's dark/light theme redesign (`c316bcf`, `c9b6183`). It is still built on hardcoded Tailwind colors with no dark-mode variant. Mounted as-is today, it would render a stark white popover with slate/blue text in an otherwise dark UI — visibly broken, defeating the point of making it reachable again. This is a necessary fix scoped to this component, not unrelated refactoring:

| Old (hardcoded) | New (semantic token, from `app/globals.css`) |
|---|---|
| `bg-white`, `border-slate-200` (panel) | `bg-popover`, `border-border` |
| `text-slate-800` (title text) | `text-popover-foreground` |
| `text-slate-500` / `text-slate-400` (body / empty state) | `text-muted-foreground` |
| `bg-blue-50` (unread row highlight) | `bg-primary/10` |
| `text-blue-600` / `hover:text-blue-700` (mark-all-read link) | `text-primary` / `hover:text-primary-accessible` |
| `bg-red-500` / `text-white` (unread count badge) | `bg-destructive` / `text-destructive-foreground` |
| `text-slate-500 hover:text-slate-800` (bell icon button) | `text-muted-foreground hover:text-foreground` |

No other behavioral or layout change to the component — same dropdown structure, same `TYPE_ICON` map, same click-outside-to-close handler, same `router.refresh()` after mark-all-read.

---

## 3. Fence removal, docs, and testing

### Fence removal

Delete both entries from `__tests__/api/fenced-routes.test.ts`:

```ts
{ path: '@/app/api/notifications/route', feature: 'notifications', methods: ['GET'] },
{ path: '@/app/api/notifications/read-all/route', feature: 'notifications', methods: ['PUT'] },
```

That file is the canonical fenced-route list; CLAUDE.md is explicit that restoring a route means removing its entry there, not just deleting the `featureUnavailable` call in the route file.

### CLAUDE.md

Update the Auth Architecture section: drop `notifications/*` from the list of routes that 503 via `lib/unavailable.ts`, and remove the paragraph noting the restore-vs-delete decision was still open (its stated rationale — "no producer had ever written that table" — already expired once alert evaluation started writing it; this design is what settles the decision on the current facts rather than the old one).

### Testing

Two new test files, mirroring the existing convention in `__tests__/api/alerts-config.test.ts` (mocked `db()`, mocked `getProfile()`):

**`__tests__/api/notifications.test.ts`** (GET):
- 401 when `getProfile()` returns null, `db()` never called.
- Returns notifications scoped to the caller's `account_id` — mock rows for two different accounts, assert only the caller's account's rows come back (proves the query filter reaches `db()`, not just that the route compiles).
- Returns `{ notifications: [] }` when the account has none.
- Returns 503 when the query throws.

**`__tests__/api/notifications-read-all.test.ts`** (PUT):
- 401 when `getProfile()` returns null.
- Asserts the update statement reaches `db()` with both `account_id` and `read = false` in its filter (proves it cannot mark another account's notifications, or already-read rows, as a side effect).
- Returns `{ ok: true }` on success.
- Returns 500 when the query throws.

**Layout unread-count degradation:** a test asserting that when the count query throws, the layout still renders (does not propagate the error) and `unreadCount` is `0` — the non-critical-degradation contract from `TopBar`'s original pattern. Add to an existing layout test file if one covers `app/[lang]/dashboard/layout.tsx` already; create a minimal one scoped to just this behavior if not.

No integration test. This is CRUD against a table whose schema (`033`, `036`) is already integration-tested elsewhere; the unit-level mocks above are sufficient, consistent with `alerts-config.test.ts`'s own scope for a structurally identical route.

---

## What this design deliberately does not do

- **Does not resurrect `TopBar`'s `{ title, subtitle }` props.** Nothing currently needs page titles rendered in shared chrome; reintroducing that is a separate, unrelated decision.
- **Does not add brand/client name display to notification rows.** The alert title text already embeds it (`"SoV Alert — Acme"`, from `buildAction` in `lib/alerts/evaluate.ts`), so the information already reaches the user without a schema join or additional UI.
- **Does not add pagination beyond the existing `limit 20`.** Unchanged from the original; the dropdown was never a full inbox.
- **Does not touch `DashboardSidebar.tsx`.** The bell mounts in a new header row in the shared layout, not inside the sidebar.
