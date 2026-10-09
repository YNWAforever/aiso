import { describe, it, expect } from 'vitest'
import { selectPendingClients } from '@/lib/pulse/schedule'

// A fake `sql` that behaves like the real selection query where it matters:
// rows come back in (created_at, id) order and the LIMIT is honoured. The
// cron-pulse route test mocks this module's query with a list that ignores the
// limit, which is exactly why it could never see a limit applied too early.
//
// Keyset parameters, when present, are read by position: the query passes
// [cursorCreatedAt, cursorCreatedAt, cursorId, pageSize]. With no cursor
// parameters the single parameter is the page size.
type Row = Record<string, unknown> & { client_id: string; cursor_created_at: string }

function fakeSql(rows: Row[]) {
  const pages: number[] = []
  const sql = ((_strings: TemplateStringsArray, ...params: unknown[]) => {
    const pageSize = Number(params[params.length - 1])
    const cursorAt = params.length >= 4 ? (params[0] as string | null) : null
    const cursorId = params.length >= 4 ? (params[2] as string | null) : null
    const ordered = [...rows].sort((a, b) =>
      a.cursor_created_at.localeCompare(b.cursor_created_at) || a.client_id.localeCompare(b.client_id))
    const after = cursorAt === null
      ? ordered
      : ordered.filter(r =>
          r.cursor_created_at > cursorAt
          || (r.cursor_created_at === cursorAt && r.client_id > (cursorId as string)))
    pages.push(pageSize)
    return Promise.resolve(after.slice(0, pageSize))
  }) as never
  return { sql, pages }
}

const PAST = '2026-01-01T00:00:00.000Z'

function row(clientId: string, createdAt: string, account: Record<string, unknown>): Row {
  return {
    client_id: clientId,
    cursor_created_at: createdAt,
    prompt_count: 8,
    scanned_prompts: 0,
    plan: 'pro', status: 'active', stripe_subscription_id: 'sub_1',
    trial_ends_at: null, override_plan: null, override_expires_at: null,
    ...account,
  }
}

// An expired trial passes the SQL prefilter (paid plan name, status not
// past_due/cancelled) but resolves to free with no platforms.
const expiredTrial = { plan: 'basic', status: 'trialing', stripe_subscription_id: null, trial_ends_at: PAST }

describe('selectPendingClients', () => {
  it('skips an ineligible oldest client instead of returning nobody', async () => {
    const { sql } = fakeSql([
      row('a-expired', '2026-01-01 00:00:00+00', expiredTrial),
      row('b-paid', '2026-02-01 00:00:00+00', {}),
    ])

    const pending = await selectPendingClients(sql, 1)

    expect(pending.map(p => p.clientId)).toEqual(['b-paid'])
  })

  it('keeps paging past a full page of ineligible clients', async () => {
    const ineligible = Array.from({ length: 120 }, (_, i) =>
      row(`x-${String(i).padStart(3, '0')}`, '2026-01-01 00:00:00+00', expiredTrial))
    const { sql } = fakeSql([...ineligible, row('z-paid', '2026-03-01 00:00:00+00', {})])

    const pending = await selectPendingClients(sql, 1)

    expect(pending.map(p => p.clientId)).toEqual(['z-paid'])
  })

  it('returns oldest eligible clients first, up to the limit', async () => {
    const { sql } = fakeSql([
      row('c', '2026-03-01 00:00:00+00', {}),
      row('a', '2026-01-01 00:00:00+00', {}),
      row('b', '2026-02-01 00:00:00+00', expiredTrial),
      row('d', '2026-04-01 00:00:00+00', {}),
    ])

    const pending = await selectPendingClients(sql, 2)

    expect(pending.map(p => p.clientId)).toEqual(['a', 'c'])
  })

  it('stops paging if the cursor fails to advance, instead of looping forever', async () => {
    // A query that keeps answering the same full page (as a NULL paging key
    // once did) must not spin the cron invocation until the platform kills it.
    const page = Array.from({ length: 50 }, (_, i) => row(`x-${i}`, '2026-01-01 00:00:00+00', expiredTrial))
    let calls = 0
    const sql = (() => { calls += 1; return Promise.resolve(page) }) as never

    expect(await selectPendingClients(sql, 1)).toEqual([])
    expect(calls).toBeLessThanOrEqual(2)
  })

  it('returns an empty list when no candidate is eligible', async () => {
    const { sql } = fakeSql([row('a', '2026-01-01 00:00:00+00', expiredTrial)])

    expect(await selectPendingClients(sql, 1)).toEqual([])
  })
})
