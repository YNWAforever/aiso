import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ sql: vi.fn(), factory: vi.fn() }))
vi.mock('@/lib/db', () => ({ db: mocks.factory }))
import { startCronRun, finishCronRun } from '@/lib/cron/recordRun'

beforeEach(() => {
  mocks.sql.mockReset()
  mocks.factory.mockReset().mockReturnValue(mocks.sql)
})
afterEach(() => vi.restoreAllMocks())

describe('cron ledger diagnostics', () => {
  it.each(['start', 'finish'] as const)(
    'keeps %s database failures secret-free without failing the job',
    async operation => {
      const secret = 'synthetic-private-error-marker'
      const error = Object.assign(new Error(secret), {
        code: '23503', detail: secret, query: secret, cause: { password: secret },
      })
      mocks.sql.mockRejectedValue(error)
      const log = vi.spyOn(console, 'error').mockImplementation(() => {})
      if (operation === 'start') {
        await expect(startCronRun('/api/cron/pulse')).resolves.toBeNull()
      } else {
        await expect(finishCronRun('run-id', 'error')).resolves.toBeUndefined()
      }
      expect(log).toHaveBeenCalledOnce()
      expect(JSON.stringify(log.mock.calls)).not.toContain(secret)
      expect(log.mock.calls[0][0]).toEqual({
        event: 'cron_ledger_write_failed', operation,
        database: { code: '23503', category: 'foreign_key_violation' },
        correlationId: expect.any(String),
      })
    },
  )

  it('also suppresses database factory error details', async () => {
    mocks.factory.mockImplementation(() => { throw new Error('synthetic-factory-secret') })
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(startCronRun('/api/cron/pulse')).resolves.toBeNull()
    expect(JSON.stringify(log.mock.calls)).not.toContain('synthetic-factory-secret')
    expect(log.mock.calls[0][0]).toEqual({
      event: 'cron_ledger_write_failed', operation: 'start',
      database: { code: 'unknown', category: 'unknown' },
      correlationId: expect.any(String),
    })
  })

  it('preserves successful recording and null-id no-op', async () => {
    mocks.sql.mockResolvedValue([{ id: 'run-id' }])
    expect(await startCronRun('/api/cron/pulse')).toBe('run-id')
    await finishCronRun(null, 'ok')
    expect(mocks.sql).toHaveBeenCalledOnce()
    await finishCronRun('run-id', 'ok', { processed: 2 })
    expect(mocks.sql).toHaveBeenCalledTimes(2)
  })
})
