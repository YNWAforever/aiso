import { beforeEach, describe, expect, it, vi } from 'vitest'
import { signScanClaimIntent, authorizedScanClaimIntent } from '@/lib/security/scan-claim-intent'
import { consumeScanClaimAttempt } from '@/lib/security/scan-claim-attempt'

/**
 * Single-use claim intents (AC-03).
 *
 * The intent has always carried an `attemptId` and has always signed it into
 * the canonical string — and nothing ever recorded it. A signed cookie that is
 * never consumed is a bearer token valid for its whole 15-minute window, so a
 * copy of it claims the scan again every time it is presented. The signature
 * proved the token was ours; it never proved this was the first use of it.
 */

const SCAN = '11111111-1111-4111-8111-111111111111'
const ATTEMPT = '22222222-2222-4222-8222-222222222222'

const queries: string[] = []
let nextResult: unknown[] | Error = []
const mockSql = vi.fn((strings: TemplateStringsArray) => {
  queries.push(strings.join('?'))
  if (nextResult instanceof Error) return Promise.reject(nextResult)
  return Promise.resolve(nextResult)
})
vi.mock('@/lib/db', () => ({ db: () => mockSql }))

beforeEach(() => {
  process.env.REPORT_SHARE_SECRET = 'x'.repeat(32)
  queries.length = 0
  nextResult = [{ attempt_id: ATTEMPT }]
  mockSql.mockClear()
})

const token = (scanId = SCAN, attemptId = ATTEMPT) =>
  signScanClaimIntent({
    scanId,
    lang: 'en',
    returnPath: `/en/result/${encodeURIComponent(scanId)}?claim=1`,
    attemptId,
  })

describe('authorizedScanClaimIntent', () => {
  /**
   * `isAuthorizedScanClaim` answers a boolean and throws the intent away,
   * which is precisely why the attemptId could never be consumed — the one
   * value needed to make the token single-use was discarded at the gate.
   */
  it('returns the intent, so the caller can consume the attempt it names', () => {
    expect(authorizedScanClaimIntent(token(), SCAN)).toMatchObject({
      scanId: SCAN,
      attemptId: ATTEMPT,
    })
  })

  it.each([
    ['an absent token', undefined],
    ['a tampered token', 'not-a-token'],
  ])('returns null for %s', (_label, value) => {
    expect(authorizedScanClaimIntent(value as string | undefined, SCAN)).toBeNull()
  })

  it('returns null when the token names a different scan', () => {
    expect(authorizedScanClaimIntent(token(), '33333333-3333-4333-8333-333333333333')).toBeNull()
  })

  it('returns null once the token has expired', () => {
    const issued = Date.now()
    expect(authorizedScanClaimIntent(token(), SCAN, issued + 16 * 60 * 1000)).toBeNull()
  })
})

describe('consumeScanClaimAttempt', () => {
  it('reports the first use as won', async () => {
    await expect(consumeScanClaimAttempt(ATTEMPT, SCAN)).resolves.toBe('consumed')
    expect(queries[0]).toMatch(/insert into scan_claim_attempts/i)
    // ON CONFLICT is the whole mechanism: the primary key decides the winner,
    // not a read followed by a write.
    expect(queries[0]).toMatch(/on conflict/i)
  })

  it('reports a replay as lost, because the insert matched nothing', async () => {
    nextResult = []

    await expect(consumeScanClaimAttempt(ATTEMPT, SCAN)).resolves.toBe('replayed')
  })

  /**
   * Fails closed. If the attempt cannot be recorded, allowing the claim would
   * let an unbounded number of replays through during the outage — the exact
   * thing this table exists to stop. The caller turns this into a 503.
   */
  it('throws rather than allowing an unrecorded claim through', async () => {
    nextResult = new Error('connection terminated unexpectedly')

    await expect(consumeScanClaimAttempt(ATTEMPT, SCAN)).rejects.toThrow()
  })

  /**
   * A denial, not an outage. Returning `invalid` rather than throwing is what
   * keeps a malformed id out of the 503 path: the caller cannot tell a bad
   * token from a broken database if both arrive as an exception.
   */
  it('reports a malformed attempt id as invalid, without touching the database', async () => {
    await expect(consumeScanClaimAttempt('not-a-uuid', SCAN)).resolves.toBe('invalid')
    expect(mockSql).not.toHaveBeenCalled()
  })
})
