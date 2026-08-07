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
      { client_id: 'client-1', scan_week: '2026-08-08', sov_score: 40 },
      { client_id: 'client-1', scan_week: '2026-08-01', sov_score: 60 },
    ],
  },
  emailsByAccount: { 'account-1': 'owner@example.com' },
  dashboardUrlByClient: { 'client-1': 'https://app.example/en/dashboard/client-1' },
})

function portsFor(data: AlertSnapshot = snapshot()) {
  const order: string[] = []
  const ports: AlertEvaluationPorts = {
    loadSnapshot: vi.fn().mockResolvedValue(data),
    upsertNotification: vi.fn(async notification => {
      order.push(`notification:${notification.type}`)
    }),
    sendAlertEmail: vi.fn(async email => {
      order.push(`email:${email.type}`)
    }),
  }
  return { ports, order }
}

describe('runAlertEvaluation', () => {
  it('creates independent threshold and week-over-week actions for one client', async () => {
    const { ports } = portsFor()

    const result = await runAlertEvaluation(ports)

    expect(result).toEqual({ processed: 1, fired: 2 })
    expect(ports.upsertNotification).toHaveBeenCalledTimes(2)
    expect(ports.sendAlertEmail).toHaveBeenCalledTimes(2)
    expect(ports.upsertNotification).toHaveBeenNthCalledWith(1, expect.objectContaining({ type: 'sov_threshold' }))
    expect(ports.upsertNotification).toHaveBeenNthCalledWith(2, expect.objectContaining({ type: 'sov_wow_drop' }))
  })

  it('does not fire threshold, week-over-week, or recovery policies when the latest score is null', async () => {
    const data = snapshot()
    data.weeksByClient['client-1'] = [
      { client_id: 'client-1', scan_week: '2026-08-08', sov_score: null },
      { client_id: 'client-1', scan_week: '2026-08-01', sov_score: 60 },
    ]
    const { ports } = portsFor(data)

    const result = await runAlertEvaluation(ports)

    expect(result).toEqual({ processed: 1, fired: 0 })
    expect(ports.upsertNotification).not.toHaveBeenCalled()
    expect(ports.sendAlertEmail).not.toHaveBeenCalled()
  })

  it('treats a null previous score as unknown instead of firing threshold, week-over-week, or recovery policies', async () => {
    const data = snapshot()
    data.weeksByClient['client-1'] = [
      { client_id: 'client-1', scan_week: '2026-08-08', sov_score: 40 },
      { client_id: 'client-1', scan_week: '2026-08-01', sov_score: null },
    ]
    const { ports } = portsFor(data)

    const result = await runAlertEvaluation(ports)

    expect(result).toEqual({ processed: 1, fired: 0 })
    expect(ports.upsertNotification).not.toHaveBeenCalled()
    expect(ports.sendAlertEmail).not.toHaveBeenCalled()
  })

  it('still fires a threshold action for a first observed below-threshold score when no previous week exists', async () => {
    const data = snapshot()
    data.weeksByClient['client-1'] = [
      { client_id: 'client-1', scan_week: '2026-08-08', sov_score: 40 },
    ]
    const { ports } = portsFor(data)

    const result = await runAlertEvaluation(ports)

    expect(result).toEqual({ processed: 1, fired: 1 })
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
          { client_id: 'client-recovery', scan_week: '2026-08-08', sov_score: 50 },
          { client_id: 'client-recovery', scan_week: '2026-08-01', sov_score: 45 },
        ],
      },
      emailsByAccount: { 'account-recovery': 'recovery@example.com' },
      dashboardUrlByClient: { 'client-recovery': 'https://app.example/en/dashboard/client-recovery' },
    }
    const { ports } = portsFor(recoverySnapshot)

    const result = await runAlertEvaluation(ports)

    expect(result).toEqual({ processed: 1, fired: 1 })
    expect(ports.upsertNotification).toHaveBeenCalledTimes(1)
    expect(ports.sendAlertEmail).toHaveBeenCalledTimes(1)
    expect(ports.upsertNotification).toHaveBeenCalledWith(expect.objectContaining({ type: 'sov_recovery' }))
    expect(ports.sendAlertEmail).toHaveBeenCalledWith(expect.objectContaining({ type: 'sov_recovery' }))
  })

  it('evaluates all actions before delivering them in deterministic order', async () => {
    const secondConfigWeeks = [
      { client_id: 'client-2', scan_week: '2026-08-08', sov_score: 60 },
      { client_id: 'client-2', scan_week: '2026-08-01', sov_score: 75 },
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
          { client_id: 'client-1', scan_week: '2026-08-08', sov_score: 40 },
          { client_id: 'client-1', scan_week: '2026-08-01', sov_score: 60 },
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

    await expect(runAlertEvaluation(ports)).resolves.toEqual({ processed: 1, fired: 2 })
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
})
