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

  it('evaluates all actions before delivering them in deterministic order', async () => {
    const { ports, order } = portsFor()

    await runAlertEvaluation(ports)

    expect(order).toEqual([
      'notification:sov_threshold', 'email:sov_threshold',
      'notification:sov_wow_drop', 'email:sov_wow_drop',
    ])
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
