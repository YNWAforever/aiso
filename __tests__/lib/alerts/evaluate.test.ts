import { describe, expect, it, vi } from 'vitest'
import {
  runAlertEvaluation,
  type AlertConfigWithClient,
  type AlertEvaluationPorts,
  type AlertSnapshot,
} from '@/lib/alerts/evaluate'

const config = (overrides: Partial<AlertConfigWithClient> = {}): AlertConfigWithClient => ({
  id: 'alert-1',
  client_id: 'client-1',
  enabled_sov: true,
  sov_threshold: 50,
  enabled_wow: true,
  wow_threshold: 10,
  notify_inapp: true,
  notify_email: true,
  client: { id: 'client-1', brand_name: 'Acme', account_id: 'account-1' },
  ...overrides,
})

const snapshot = (configs: AlertConfigWithClient[] = [config()]): AlertSnapshot => ({
  configs,
  weeksByClient: {
    'client-1': [
      { client_id: 'client-1', scan_week: '2026-08-10', sov_score: 40 },
      { client_id: 'client-1', scan_week: '2026-08-03', sov_score: 60 },
    ],
  },
  emailsByAccount: { 'account-1': 'owner@example.com' },
  dashboardUrlByClient: { 'client-1': 'https://app.example/en/dashboard/client-1' },
  // Matches weeksByClient[0] so the default fixture is fresh, not stale.
  currentScanWeek: '2026-08-10',
})

function portsFor(data: AlertSnapshot = snapshot()) {
  const order: string[] = []
  const claimed = new Set<string>()
  const ports: AlertEvaluationPorts = {
    loadSnapshot: vi.fn().mockResolvedValue(data),
    upsertNotification: vi.fn(async notification => {
      order.push(`notification:${notification.type}`)
    }),
    // Fake the unique index: the first claim for a key wins, later ones do not.
    claimEmailDelivery: vi.fn(async key => {
      const id = `${key.client_id}:${key.type}:${key.scan_week}`
      if (claimed.has(id)) return false
      claimed.add(id)
      return true
    }),
    releaseEmailDelivery: vi.fn(async key => {
      claimed.delete(`${key.client_id}:${key.type}:${key.scan_week}`)
    }),
    sendAlertEmail: vi.fn(async email => {
      order.push(`email:${email.type}`)
    }),
  }
  return { ports, order, claimed }
}

describe('runAlertEvaluation', () => {
  it('creates independent threshold and week-over-week actions for one client', async () => {
    const { ports } = portsFor()

    const result = await runAlertEvaluation(ports)

    expect(result).toEqual({ processed: 1, stale: 0, fired: 2, emailed: 2, deferred: 0, emailFailures: 0, notificationFailures: 0 })
    expect(ports.upsertNotification).toHaveBeenCalledTimes(2)
    expect(ports.sendAlertEmail).toHaveBeenCalledTimes(2)
    expect(ports.upsertNotification).toHaveBeenNthCalledWith(1, expect.objectContaining({ type: 'sov_threshold' }))
    expect(ports.upsertNotification).toHaveBeenNthCalledWith(2, expect.objectContaining({ type: 'sov_wow_drop' }))
  })

  it('does not fire threshold, week-over-week, or recovery policies when the latest score is null', async () => {
    const data = snapshot()
    data.weeksByClient['client-1'] = [
      { client_id: 'client-1', scan_week: '2026-08-10', sov_score: null },
      { client_id: 'client-1', scan_week: '2026-08-03', sov_score: 60 },
    ]
    const { ports } = portsFor(data)

    const result = await runAlertEvaluation(ports)

    expect(result).toEqual({ processed: 1, stale: 0, fired: 0, emailed: 0, deferred: 0, emailFailures: 0, notificationFailures: 0 })
    expect(ports.upsertNotification).not.toHaveBeenCalled()
    expect(ports.sendAlertEmail).not.toHaveBeenCalled()
  })

  it('treats a null previous score as unknown instead of firing threshold, week-over-week, or recovery policies', async () => {
    const data = snapshot()
    data.weeksByClient['client-1'] = [
      { client_id: 'client-1', scan_week: '2026-08-10', sov_score: 40 },
      { client_id: 'client-1', scan_week: '2026-08-03', sov_score: null },
    ]
    const { ports } = portsFor(data)

    const result = await runAlertEvaluation(ports)

    expect(result).toEqual({ processed: 1, stale: 0, fired: 0, emailed: 0, deferred: 0, emailFailures: 0, notificationFailures: 0 })
    expect(ports.upsertNotification).not.toHaveBeenCalled()
    expect(ports.sendAlertEmail).not.toHaveBeenCalled()
  })

  it('still fires a threshold action for a first observed below-threshold score when no previous week exists', async () => {
    const data = snapshot()
    data.weeksByClient['client-1'] = [
      { client_id: 'client-1', scan_week: '2026-08-10', sov_score: 40 },
    ]
    const { ports } = portsFor(data)

    const result = await runAlertEvaluation(ports)

    expect(result).toEqual({ processed: 1, stale: 0, fired: 1, emailed: 1, deferred: 0, emailFailures: 0, notificationFailures: 0 })
    expect(ports.upsertNotification).toHaveBeenCalledWith(expect.objectContaining({ type: 'sov_threshold' }))
    expect(ports.sendAlertEmail).toHaveBeenCalledWith(expect.objectContaining({
      type: 'sov_threshold',
      currentSov: 40,
      previousSov: undefined,
    }))
  })

  it('creates an independent recovery action when sov returns to the threshold', async () => {
    const recoveryConfig = config({
      id: 'alert-recovery',
      client_id: 'client-recovery',
      enabled_wow: false,
      client: { id: 'client-recovery', brand_name: 'Recovered Co', account_id: 'account-recovery' },
    })
    const recoverySnapshot: AlertSnapshot = {
      configs: [recoveryConfig],
      weeksByClient: {
        'client-recovery': [
          { client_id: 'client-recovery', scan_week: '2026-08-10', sov_score: 50 },
          { client_id: 'client-recovery', scan_week: '2026-08-03', sov_score: 45 },
        ],
      },
      emailsByAccount: { 'account-recovery': 'recovery@example.com' },
      dashboardUrlByClient: { 'client-recovery': 'https://app.example/en/dashboard/client-recovery' },
      // Matches weeksByClient['client-recovery'][0] so this fixture is fresh.
      currentScanWeek: '2026-08-10',
    }
    const { ports } = portsFor(recoverySnapshot)

    const result = await runAlertEvaluation(ports)

    expect(result).toEqual({ processed: 1, stale: 0, fired: 1, emailed: 1, deferred: 0, emailFailures: 0, notificationFailures: 0 })
    expect(ports.upsertNotification).toHaveBeenCalledTimes(1)
    expect(ports.sendAlertEmail).toHaveBeenCalledTimes(1)
    expect(ports.upsertNotification).toHaveBeenCalledWith(expect.objectContaining({ type: 'sov_recovery' }))
    expect(ports.sendAlertEmail).toHaveBeenCalledWith(expect.objectContaining({ type: 'sov_recovery' }))
  })

  it('evaluates all actions before delivering them in deterministic order', async () => {
    const secondConfigWeeks = [
      { client_id: 'client-2', scan_week: '2026-08-10', sov_score: 60 },
      { client_id: 'client-2', scan_week: '2026-08-03', sov_score: 75 },
    ]
    const data: AlertSnapshot = {
      configs: [
        config({ enabled_wow: false }),
        config({
          id: 'alert-2',
          client_id: 'client-2',
          enabled_sov: false,
          wow_threshold: 10,
          client: { id: 'client-2', brand_name: 'Bravo', account_id: 'account-2' },
        }),
      ],
      weeksByClient: {
        'client-1': [
          { client_id: 'client-1', scan_week: '2026-08-10', sov_score: 40 },
          { client_id: 'client-1', scan_week: '2026-08-03', sov_score: 60 },
        ],
        'client-2': secondConfigWeeks,
      },
      emailsByAccount: {
        'account-1': 'owner@example.com',
        'account-2': 'bravo@example.com',
      },
      dashboardUrlByClient: {
        'client-1': 'https://app.example/en/dashboard/client-1',
        'client-2': 'https://app.example/en/dashboard/client-2',
      },
      // Matches both clients' weeksByClient[0] so this fixture is fresh.
      currentScanWeek: '2026-08-10',
    }
    const { ports, order } = portsFor(data)
    vi.mocked(ports.upsertNotification).mockImplementation(async notification => {
      order.push(`notification:${notification.type}:${notification.client_id}`)
      if (notification.client_id === 'client-1') {
        secondConfigWeeks[0].sov_score = 74
        secondConfigWeeks[1].sov_score = 75
      }
    })
    vi.mocked(ports.sendAlertEmail).mockImplementation(async email => {
      order.push(`email:${email.type}:${email.clientId}`)
    })

    await runAlertEvaluation(ports)

    expect(order).toEqual([
      'notification:sov_threshold:client-1', 'email:sov_threshold:client-1',
      'notification:sov_wow_drop:client-2', 'email:sov_wow_drop:client-2',
    ])
    expect(ports.upsertNotification).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ type: 'sov_wow_drop', client_id: 'client-2' }),
    )
    expect(ports.sendAlertEmail).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ type: 'sov_wow_drop', clientId: 'client-2' }),
    )
  })

  it('continues after notification or email adapter failures', async () => {
    const { ports } = portsFor()
    vi.mocked(ports.upsertNotification).mockRejectedValueOnce(new Error('notification unavailable'))
    vi.mocked(ports.sendAlertEmail).mockRejectedValueOnce(new Error('email unavailable'))

    await expect(runAlertEvaluation(ports)).resolves.toEqual({
      processed: 1,
      stale: 0,
      fired: 2,
      emailed: 1,
      deferred: 0,
      emailFailures: 1,
      notificationFailures: 1,
    })
    expect(ports.upsertNotification).toHaveBeenCalledTimes(2)
    expect(ports.sendAlertEmail).toHaveBeenCalledTimes(2)
  })

  it('counts a failing upsertNotification independently of email delivery, which still reflects successful sends', async () => {
    // The bug this closes: emailFailures had no counterpart, so a notification
    // write that fails on every run (e.g. migration 033's index missing, so the
    // ON CONFLICT arbiter 42P10s) was invisible -- emails kept sending and the
    // run looked fully healthy.
    const { ports } = portsFor()
    vi.mocked(ports.upsertNotification).mockRejectedValueOnce(new Error('42P10 no unique or exclusion constraint'))

    const result = await runAlertEvaluation(ports)

    expect(result).toEqual({ processed: 1, stale: 0, fired: 2, emailed: 2, deferred: 0, emailFailures: 0, notificationFailures: 1 })
    expect(ports.upsertNotification).toHaveBeenCalledTimes(2)
    expect(ports.sendAlertEmail).toHaveBeenCalledTimes(2)
  })

  it('propagates snapshot-loading failures without attempting delivery', async () => {
    const { ports } = portsFor()
    vi.mocked(ports.loadSnapshot).mockRejectedValueOnce(new Error('snapshot unavailable'))

    await expect(runAlertEvaluation(ports)).rejects.toThrow('snapshot unavailable')
    expect(ports.upsertNotification).not.toHaveBeenCalled()
    expect(ports.sendAlertEmail).not.toHaveBeenCalled()
  })

  it('skips a client whose latest aggregate week is not the current week', async () => {
    // The silent drop this closes. With the rollup not yet landed, weeks[0] is
    // LAST week's row. The evaluator used to re-derive last week's action,
    // whose ledger row last week's run already claimed, so the claim returned
    // false and the outcome was 'suppressed' -- reported as
    // {fired: 1, emailed: 0, emailFailures: 0}, which is byte-identical to a
    // healthy idempotent re-run. The client's real current-week alert was never
    // computed and nothing anywhere said so.
    const data = snapshot()
    data.currentScanWeek = '2026-08-17'   // a week later than the fixture rows

    const { ports } = portsFor(data)

    const result = await runAlertEvaluation(ports)

    expect(result).toEqual({
      processed: 1,
      stale: 1,
      fired: 0,
      emailed: 0,
      deferred: 0,
      emailFailures: 0,
      notificationFailures: 0,
    })
    expect(ports.upsertNotification).not.toHaveBeenCalled()
    expect(ports.claimEmailDelivery).not.toHaveBeenCalled()
    expect(ports.sendAlertEmail).not.toHaveBeenCalled()
  })

  it('does not count a client with no weeks at all as stale', async () => {
    // A brand new client has never had a rollup. That is not the same fault as
    // a client whose rollup stopped landing, and conflating them would make the
    // stale counter fire on every legitimately new workspace.
    const data = snapshot()
    data.weeksByClient['client-1'] = []

    const { ports } = portsFor(data)

    const result = await runAlertEvaluation(ports)

    expect(result.stale).toBe(0)
    expect(result.fired).toBe(0)
  })
})

describe('email idempotence', () => {
  it('sends nothing on a second run over the same week', async () => {
    // The bug this closes: the notification insert dedupes through its unique
    // index, so a re-run wrote no duplicate row but still sent every email.
    const { ports } = portsFor()

    const first = await runAlertEvaluation(ports)
    const firstRunSends = (ports.sendAlertEmail as ReturnType<typeof vi.fn>).mock.calls.length
    const second = await runAlertEvaluation(ports)

    expect(firstRunSends).toBe(2)
    expect(ports.sendAlertEmail).toHaveBeenCalledTimes(2)
    expect(first).toMatchObject({ emailed: 2, emailFailures: 0 })
    expect(second).toMatchObject({ emailed: 0, emailFailures: 0 })
    // A suppressed re-send is not a failure and must never trigger a release.
    expect(ports.releaseEmailDelivery).not.toHaveBeenCalled()
  })

  it('claims before sending, matching the order that makes the send-once test above hold', async () => {
    const { ports } = portsFor()

    await runAlertEvaluation(ports)

    const claimOrder = (ports.claimEmailDelivery as ReturnType<typeof vi.fn>)
      .mock.invocationCallOrder[0]
    const sendOrder = (ports.sendAlertEmail as ReturnType<typeof vi.fn>)
      .mock.invocationCallOrder[0]
    expect(claimOrder).toBeLessThan(sendOrder)
  })

  it('releases the claim when the send fails, so the next run retries', async () => {
    const { ports } = portsFor()
    ;(ports.sendAlertEmail as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('resend is down'))

    await runAlertEvaluation(ports)

    expect(ports.releaseEmailDelivery).toHaveBeenCalledTimes(1)
    expect(ports.releaseEmailDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'sov_threshold', scan_week: '2026-08-10' }),
    )

    // Prove the release actually enables a retry, not just that it was called.
    await runAlertEvaluation(ports)
    expect(ports.sendAlertEmail).toHaveBeenCalledTimes(3)
    expect(ports.sendAlertEmail).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ type: 'sov_threshold' }),
    )
  })

  it('does not send when the claim itself fails', async () => {
    // A dead ledger must fail closed. Sending anyway would be the old bug with
    // extra steps: no record written, so every subsequent run re-sends.
    const { ports } = portsFor()
    ;(ports.claimEmailDelivery as ReturnType<typeof vi.fn>)
      .mockRejectedValue(new Error('ledger unavailable'))

    const result = await runAlertEvaluation(ports)

    expect(ports.sendAlertEmail).not.toHaveBeenCalled()
    // Notifications are independent of the email ledger and still land.
    expect(ports.upsertNotification).toHaveBeenCalledTimes(2)
    expect(result.fired).toBe(2)
    // The outage must be visible to the caller, not silently equivalent to a
    // healthy suppressed re-run — that's the whole point of emailFailures.
    expect(result.emailed).toBe(0)
    expect(result.emailFailures).toBe(2)
  })

  it('passes the recipient as ledger payload', async () => {
    const { ports } = portsFor()

    await runAlertEvaluation(ports)

    expect(ports.claimEmailDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        client_id: 'client-1',
        recipient: 'owner@example.com',
        scan_week: '2026-08-10',
      }),
    )
  })
})
