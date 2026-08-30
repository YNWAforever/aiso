import { describe, expect, it, vi } from 'vitest'
import { markCompleteIfAllPresent } from '@/lib/agents'

function makeSql(results: unknown[][]) {
  let i = 0
  return vi.fn<(strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>>(
    () => Promise.resolve(results[i++] ?? []),
  )
}

describe('markCompleteIfAllPresent', () => {
  it('marks the scan complete when all three tables have at least one row', async () => {
    const sql = makeSql([[{ exists: 1 }], [{ exists: 1 }], [{ exists: 1 }], []])

    await markCompleteIfAllPresent(sql as never, 'scan-1')

    expect(sql).toHaveBeenCalledTimes(4) // 3 existence checks + the update
    const updateStrings = sql.mock.calls[3]![0] as TemplateStringsArray
    expect(updateStrings.join('?')).toMatch(/update scans set agent_status = 'complete'/i)
  })

  it('does not update when one table has no rows yet', async () => {
    const sql = makeSql([[{ exists: 1 }], [], [{ exists: 1 }]])

    await markCompleteIfAllPresent(sql as never, 'scan-1')

    expect(sql).toHaveBeenCalledTimes(3) // only the 3 existence checks, no update call
  })

  it('does not update when only recs has no rows yet', async () => {
    const sql = makeSql([[], [{ exists: 1 }], [{ exists: 1 }]])

    await markCompleteIfAllPresent(sql as never, 'scan-1')

    expect(sql).toHaveBeenCalledTimes(3) // only the 3 existence checks, no update call
  })

  it('does not update when only competitors has no rows yet', async () => {
    const sql = makeSql([[{ exists: 1 }], [{ exists: 1 }], []])

    await markCompleteIfAllPresent(sql as never, 'scan-1')

    expect(sql).toHaveBeenCalledTimes(3) // only the 3 existence checks, no update call
  })

  it('does not update when none of the tables have rows yet', async () => {
    const sql = makeSql([[], [], []])

    await markCompleteIfAllPresent(sql as never, 'scan-1')

    expect(sql).toHaveBeenCalledTimes(3)
  })

  it('logs and resolves without throwing when a query fails', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('connection terminated'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(markCompleteIfAllPresent(sql as never, 'scan-1')).resolves.toBeUndefined()

    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })
})
