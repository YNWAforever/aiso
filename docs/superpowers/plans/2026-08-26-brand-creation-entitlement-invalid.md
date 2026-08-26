# Brand creation: map ACCOUNT_ENTITLEMENT_INVALID Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** `POST /api/dashboard/clients` returns a specific `409 ACCOUNT_ENTITLEMENT_INVALID`
instead of a generic `500 "Failed to create brand"` when the `check_brand_limit()` trigger
raises `ACCOUNT_ENTITLEMENT_INVALID` (a malformed account `plan`/`status` with no live admin
override).

**Architecture:** One new `message.includes(...)` branch in the route's existing `catch` block,
mirroring the `BRAND_LIMIT_REACHED` branch immediately above it. One new test case mirroring the
existing `BRAND_LIMIT_REACHED` race-condition test. No other files change.

**Tech Stack:** Next.js 16 route handler, Vitest. No DB/migration changes — the trigger already
raises this exception correctly (`supabase/migrations/026_effective_brand_limit.sql`,
`028_account_plan_overrides.sql`, covered by `__tests__/db/brand-limit-entitlement.test.ts`).

Full design context: `docs/superpowers/specs/2026-08-26-brand-creation-entitlement-invalid-design.md`.

---

### Task 1: Map ACCOUNT_ENTITLEMENT_INVALID to a 409 response

**Files:**
- Modify: `app/api/dashboard/clients/route.ts:56-58`
- Test: `__tests__/api/dashboard-clients.test.ts:71-76`

- [ ] **Step 1: Write the failing test**

In `__tests__/api/dashboard-clients.test.ts`, add a new test immediately after the existing
`'returns 403 when the trigger raises BRAND_LIMIT_REACHED on the race'` test (which currently
ends at line 75 with the closing `})` on line 76):

```typescript
  it('returns 409 when the trigger raises ACCOUNT_ENTITLEMENT_INVALID', async () => {
    nextResults = [[{ n: 0 }], new Error('ACCOUNT_ENTITLEMENT_INVALID') as never]
    const res = await POST(request({ brand_name: 'Acme' }))
    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({ error: 'ACCOUNT_ENTITLEMENT_INVALID' })
  })
```

Insert it as its own `it(...)` block, directly below the `BRAND_LIMIT_REACHED` race test and
above `'returns 500 when the database fails, not a silent success'`. Do not modify any other
test in the file.

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npx vitest run --exclude '**/node_modules/**' --exclude '**/.claude/worktrees/**' --exclude 'tests/e2e/**' "__tests__/api/dashboard-clients.test.ts"
```

Expected: FAIL — the new test expects `409`, but the current route falls through to the generic
handler and returns `500` (with `{ error: 'Failed to create brand' }`), because nothing today
matches the `ACCOUNT_ENTITLEMENT_INVALID` message. All other tests in the file must still pass;
only the new one fails.

- [ ] **Step 3: Implement the minimal fix**

In `app/api/dashboard/clients/route.ts`, the `catch` block currently reads:

```typescript
  } catch (err) {
    // Neon throws where supabase-js resolved { data, error }. The trigger raises
    // BRAND_LIMIT_REACHED when a concurrent request won the race.
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('BRAND_LIMIT_REACHED')) {
      return NextResponse.json({ error: 'BRAND_LIMIT_REACHED', plan, limit }, { status: 403 })
    }

    const diagnostic = sanitizeDatabaseError(err, {
```

Change it to:

```typescript
  } catch (err) {
    // Neon throws where supabase-js resolved { data, error }. The trigger raises
    // BRAND_LIMIT_REACHED when a concurrent request won the race.
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('BRAND_LIMIT_REACHED')) {
      return NextResponse.json({ error: 'BRAND_LIMIT_REACHED', plan, limit }, { status: 403 })
    }
    if (message.includes('ACCOUNT_ENTITLEMENT_INVALID')) {
      // The account's own stored plan/status is malformed and no live admin
      // override rescues it (see the admin-plan-override design doc). This is
      // a diagnosable account-state fault, not a generic database error — it
      // must not be folded into the sanitizeDatabaseError/500 path below.
      console.error(`[dashboard/clients] entitlement invalid for account ${profile.account_id}`)
      return NextResponse.json({ error: 'ACCOUNT_ENTITLEMENT_INVALID' }, { status: 409 })
    }

    const diagnostic = sanitizeDatabaseError(err, {
```

Only these lines change. Nothing else in the file moves.

- [ ] **Step 4: Run the test to verify it passes**

Run the same command as Step 2:

```bash
npx vitest run --exclude '**/node_modules/**' --exclude '**/.claude/worktrees/**' --exclude 'tests/e2e/**' "__tests__/api/dashboard-clients.test.ts"
```

Expected: PASS — all tests in the file green, including the new one.

- [ ] **Step 5: Commit**

```bash
git add app/api/dashboard/clients/route.ts __tests__/api/dashboard-clients.test.ts
git commit -m "fix(brand-creation): map ACCOUNT_ENTITLEMENT_INVALID to a 409, not a generic 500"
```
