import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ sql: vi.fn() }))
vi.mock('@/lib/db', () => ({ db: () => mocks.sql }))

import { ACTIVATION_MILESTONES, readActivation } from '@/lib/telemetry/activation'

/**
 * Activation is derived from rows that already exist rather than from emitted
 * events. These cases pin the two properties that make it worth having: a
 * milestone that has not happened is null rather than absent-or-zero, and the
 * reported progress is CONSECUTIVE, so a gap in the middle cannot be skipped.
 */

const ACCOUNT = 'account-1'
const at = (day: number) => new Date(`2026-09-${String(day).padStart(2, '0')}T00:00:00.000Z`)

function rows(row: Record<string, unknown>) {
  mocks.sql.mockResolvedValue([row])
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.sql.mockResolvedValue([{}])
})

describe('activation milestones', () => {
  it('reads every milestone in a single statement', async () => {
    await readActivation(ACCOUNT)

    // Six separate queries would let a row land between them and produce a funnel
    // that never existed at any single moment.
    expect(mocks.sql).toHaveBeenCalledOnce()
  })

  it('reports a milestone that has not happened as null, never as a zero', async () => {
    rows({ first_scan: at(1) })

    const activation = await readActivation(ACCOUNT, at(30))

    expect(activation.reached.first_scan).toBe('2026-09-01T00:00:00.000Z')
    expect(activation.reached.first_source).toBeNull()
    expect(activation.reached.first_export).toBeNull()
  })

  it('normalises driver Date values and ISO strings alike', async () => {
    rows({ first_scan: at(1), first_workspace: '2026-09-02T00:00:00.000Z' })

    const activation = await readActivation(ACCOUNT, at(30))

    expect(activation.reached.first_scan).toBe('2026-09-01T00:00:00.000Z')
    expect(activation.reached.first_workspace).toBe('2026-09-02T00:00:00.000Z')
  })

  it('covers exactly the declared milestone vocabulary', async () => {
    const activation = await readActivation(ACCOUNT)

    expect(Object.keys(activation.reached).sort()).toEqual([...ACTIVATION_MILESTONES].sort())
  })
})

describe('furthest progress is consecutive', () => {
  it('stops at the first gap rather than reporting the highest milestone reached', async () => {
    // An account with an export but no approved work has something wrong with it.
    // Reporting it as "exported" would hide exactly that.
    rows({ first_scan: at(1), first_workspace: at(2), first_export: at(9) })

    const activation = await readActivation(ACCOUNT, at(30))

    expect(activation.furthest).toBe('first_workspace')
    expect(activation.reached.first_export).toBe('2026-09-09T00:00:00.000Z')
  })

  it('reports null when nothing has happened at all', async () => {
    const activation = await readActivation(ACCOUNT, at(30))

    expect(activation.furthest).toBeNull()
  })

  it('walks the whole chain when every step is present', async () => {
    rows(Object.fromEntries(ACTIVATION_MILESTONES.map((milestone, i) => [milestone, at(i + 1)])))

    const activation = await readActivation(ACCOUNT, at(30))

    expect(activation.furthest).toBe('first_declared_delivery')
  })
})

describe('a failed read is not an inactive account', () => {
  it('throws rather than reporting every milestone as null', async () => {
    mocks.sql.mockRejectedValue(new Error('connection lost'))

    // Swallowing this would turn a database incident into a cohort of accounts
    // that appear to have done nothing.
    await expect(readActivation(ACCOUNT)).rejects.toThrow('connection lost')
  })
})
