import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AlertEvaluationPorts } from '@/lib/alerts/evaluate'

type SupabaseState = {
  alertConfigReads: string[]
  alertConfigFilters: string[]
  alertConfigRangeCalls: Array<{ from: number; to: number }>
  weeklySnapshotRpcCalls: Array<{ functionName: string; args: { p_client_ids: string[] } }>
  weeklySnapshotRangeCalls: Array<{ from: number; to: number }>
  profileReads: string[]
  profileInCalls: Array<{ column: string; values: string[] }>
  profileRangeCalls: Array<{ from: number; to: number }>
  notificationUpserts: Array<{
    value: Record<string, unknown>
    options: { onConflict: string; ignoreDuplicates: boolean }
  }>
  authUserLookups: string[]
}

type SupabaseFixture = {
  configRows?: Record<string, unknown>[]
  configError?: Error | null
  weeklySnapshotRows?: Array<{ client_id: string; scan_week: string; sov_score: number }>
  weeklySnapshotError?: Error | null
  profileRows?: Array<{ id: string; account_id: string }>
  profileError?: Error | null
  emailsByProfileId?: Record<string, string | null>
  authErrorsByProfileId?: Record<string, Error>
  notificationError?: Error | null
}

const h = vi.hoisted(() => ({
  createClient: vi.fn(),
  runAlertEvaluation: vi.fn(),
  sendAlertEmail: vi.fn(),
  supabaseState: null as SupabaseState | null,
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: h.createClient,
}))

vi.mock('@/lib/alerts/evaluate', () => ({
  runAlertEvaluation: h.runAlertEvaluation,
}))

vi.mock('@/lib/resend', () => ({
  sendAlertEmail: h.sendAlertEmail,
}))

function defaultConfigRows() {
  return [
    {
      id: 'alert-1',
      client_id: 'client-1',
      enabled_sov: true,
      sov_threshold: 50,
      enabled_wow: true,
      wow_threshold: 10,
      notify_email: true,
      notify_inapp: true,
      clients: { id: 'client-1', brand_name: 'Acme', account_id: 'account-1' },
    },
    {
      id: 'alert-2',
      client_id: 'client-2',
      enabled_sov: true,
      sov_threshold: 40,
      enabled_wow: false,
      wow_threshold: 10,
      notify_email: true,
      notify_inapp: true,
      clients: { id: 'client-2', brand_name: 'Bravo', account_id: 'account-1' },
    },
    {
      id: 'alert-3',
      client_id: 'client-3',
      enabled_sov: false,
      sov_threshold: 55,
      enabled_wow: true,
      wow_threshold: 8,
      notify_email: false,
      notify_inapp: true,
      clients: { id: 'client-3', brand_name: 'Charlie', account_id: 'account-2' },
    },
  ]
}

function defaultWeekRows() {
  return [
    { client_id: 'client-1', scan_week: '2026-08-07', sov_score: 40 },
    { client_id: 'client-2', scan_week: '2026-08-07', sov_score: 61 },
    { client_id: 'client-3', scan_week: '2026-08-07', sov_score: 52 },
    { client_id: 'client-1', scan_week: '2026-07-31', sov_score: 55 },
    { client_id: 'client-2', scan_week: '2026-07-31', sov_score: 63 },
    { client_id: 'client-1', scan_week: '2026-07-24', sov_score: 60 },
  ]
}

function defaultProfileRows() {
  return [
    { id: 'profile-1a', account_id: 'account-1' },
    { id: 'profile-1b', account_id: 'account-1' },
    { id: 'profile-2a', account_id: 'account-2' },
  ]
}

function makeSupabaseStub(fixture: SupabaseFixture = {}) {
  const state: SupabaseState = {
    alertConfigReads: [],
    alertConfigFilters: [],
    alertConfigRangeCalls: [],
    weeklySnapshotRpcCalls: [],
    weeklySnapshotRangeCalls: [],
    profileReads: [],
    profileInCalls: [],
    profileRangeCalls: [],
    notificationUpserts: [],
    authUserLookups: [],
  }

  const configRows = fixture.configRows ?? defaultConfigRows()
  const weeklySnapshotRows = fixture.weeklySnapshotRows ?? defaultWeekRows()
  const profileRows = fixture.profileRows ?? defaultProfileRows()
  const emailsByProfileId = fixture.emailsByProfileId ?? {
    'profile-1a': 'owner@example.com',
    'profile-1b': 'duplicate@example.com',
    'profile-2a': 'ops@example.com',
  }

  function pageRows<T>(
    rows: T[],
    error: Error | null,
    rangeCalls: Array<{ from: number; to: number }>,
  ) {
    return {
      range: vi.fn((from: number, to: number) => {
        rangeCalls.push({ from, to })
        return Promise.resolve({
          data: rows.slice(from, to + 1),
          error,
        })
      }),
    }
  }

  const client = {
    from: vi.fn((table: string) => {
      if (table === 'alert_configs') {
        return {
          select: vi.fn((selection: string) => {
            state.alertConfigReads.push(selection)
            return {
              or: vi.fn((filter: string) => {
                state.alertConfigFilters.push(filter)
                return pageRows(configRows, fixture.configError ?? null, state.alertConfigRangeCalls)
              }),
            }
          }),
        }
      }

      if (table === 'profiles') {
        return {
          select: vi.fn((selection: string) => {
            state.profileReads.push(selection)
            return {
              in: vi.fn((column: string, values: string[]) => {
                state.profileInCalls.push({ column, values })
                return pageRows(profileRows, fixture.profileError ?? null, state.profileRangeCalls)
              }),
            }
          }),
        }
      }

      if (table === 'notifications') {
        return {
          upsert: vi.fn((value: Record<string, unknown>, options: { onConflict: string; ignoreDuplicates: boolean }) => {
            state.notificationUpserts.push({ value, options })
            return Promise.resolve({ error: fixture.notificationError ?? null })
          }),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    }),
    auth: {
      admin: {
        getUserById: vi.fn((profileId: string) => {
          state.authUserLookups.push(profileId)
          const error = fixture.authErrorsByProfileId?.[profileId] ?? null
          return Promise.resolve(
            error
              ? { data: { user: null }, error }
              : {
                  data: {
                    user: { email: emailsByProfileId[profileId] ?? null },
                  },
                  error: null,
                },
          )
        }),
      },
    },
    rpc: vi.fn((functionName: string, args: { p_client_ids: string[] }) => {
      state.weeklySnapshotRpcCalls.push({ functionName, args })
      return pageRows(
        weeklySnapshotRows,
        fixture.weeklySnapshotError ?? null,
        state.weeklySnapshotRangeCalls,
      )
    }),
  }

  return { client, state }
}

function makeRequest(secret?: string) {
  return new Request('http://localhost/api/cron/evaluate-alerts', {
    method: 'POST',
    headers: secret ? { 'x-cron-secret': secret } : undefined,
  })
}

async function importRoute() {
  return import('@/app/api/cron/evaluate-alerts/route')
}

describe('POST /api/cron/evaluate-alerts', () => {
  beforeEach(() => {
    vi.resetModules()
    h.createClient.mockReset()
    h.runAlertEvaluation.mockReset()
    h.sendAlertEmail.mockReset()
    h.supabaseState = null

    process.env.CRON_SECRET = 'test-cron-secret'
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.example'

    h.createClient.mockImplementation(() => {
      const { client, state } = makeSupabaseStub()
      h.supabaseState = state
      return client
    })
  })

  it('returns 500 when CRON_SECRET is not configured', async () => {
    delete process.env.CRON_SECRET

    const { POST } = await importRoute()
    const response = await POST(makeRequest())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Cron not configured' })
    expect(h.createClient).not.toHaveBeenCalled()
    expect(h.runAlertEvaluation).not.toHaveBeenCalled()
  })

  it('returns 401 when x-cron-secret header is missing', async () => {
    const { POST } = await importRoute()
    const response = await POST(makeRequest())

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(h.createClient).not.toHaveBeenCalled()
    expect(h.runAlertEvaluation).not.toHaveBeenCalled()
  })

  it('returns 401 when x-cron-secret header is wrong', async () => {
    const { POST } = await importRoute()
    const response = await POST(makeRequest('wrong-secret'))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(h.createClient).not.toHaveBeenCalled()
    expect(h.runAlertEvaluation).not.toHaveBeenCalled()
  })

  it('delegates to the evaluator and returns its result for valid auth', async () => {
    h.runAlertEvaluation.mockResolvedValue({ processed: 1, fired: 1 })

    const { POST } = await importRoute()
    const response = await POST(makeRequest('test-cron-secret'))

    expect(h.createClient).toHaveBeenCalledWith(
      'https://test.supabase.co',
      'test-service-role-key',
    )
    expect(h.runAlertEvaluation).toHaveBeenCalledTimes(1)
    expect(h.runAlertEvaluation).toHaveBeenCalledWith(expect.objectContaining({
      loadSnapshot: expect.any(Function),
      upsertNotification: expect.any(Function),
      sendAlertEmail: expect.any(Function),
    }))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ processed: 1, fired: 1 })
  })

  it('executes the route-owned adapters with batched reads, snapshot normalization, deduped auth lookups, notification upserts, and explicit resend payload mapping', async () => {
    const seenSnapshots: Array<Awaited<ReturnType<AlertEvaluationPorts['loadSnapshot']>>> = []
    h.runAlertEvaluation.mockImplementation(async (ports: AlertEvaluationPorts) => {
      const snapshot = await ports.loadSnapshot()
      seenSnapshots.push(snapshot)
      await ports.upsertNotification({
        account_id: 'account-1',
        client_id: 'client-1',
        type: 'sov_threshold',
        title: 'SoV Alert — Acme',
        message: 'SoV fell below 50% threshold (current: 40%).',
        read: false,
        scan_week: '2026-08-07',
      })
      await ports.sendAlertEmail({
        to: 'owner@example.com',
        clientId: 'client-1',
        brandName: 'Acme',
        type: 'sov_threshold',
        currentSov: 40,
        previousSov: 55,
        threshold: 50,
        dashboardUrl: 'https://app.example/en/dashboard/client-1',
      })
      return { processed: snapshot.configs.length, fired: 1 }
    })

    const { POST } = await importRoute()
    const response = await POST(makeRequest('test-cron-secret'))
    const state = h.supabaseState

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ processed: 3, fired: 1 })

    expect(state).not.toBeNull()
    expect(state?.alertConfigReads).toEqual(['*, clients(id, brand_name, account_id)'])
    expect(state?.alertConfigFilters).toEqual(['enabled_sov.eq.true,enabled_wow.eq.true'])
    expect(state?.alertConfigRangeCalls).toEqual([{ from: 0, to: 999 }])
    expect(state?.weeklySnapshotRpcCalls).toEqual([
      {
        functionName: 'get_alert_weekly_snapshot',
        args: { p_client_ids: ['client-1', 'client-2', 'client-3'] },
      },
    ])
    expect(state?.weeklySnapshotRangeCalls).toEqual([{ from: 0, to: 999 }])
    expect(state?.profileReads).toEqual(['id, account_id'])
    expect(state?.profileInCalls).toEqual([
      { column: 'account_id', values: ['account-1', 'account-2'] },
    ])
    expect(state?.profileRangeCalls).toEqual([{ from: 0, to: 999 }])
    expect(state?.authUserLookups).toEqual(['profile-1a', 'profile-2a'])

    expect(seenSnapshots).toHaveLength(1)
    expect(seenSnapshots[0]).toEqual({
      configs: [
        {
          id: 'alert-1',
          client_id: 'client-1',
          enabled_sov: true,
          sov_threshold: 50,
          enabled_wow: true,
          wow_threshold: 10,
          notify_email: true,
          notify_inapp: true,
          client: { id: 'client-1', brand_name: 'Acme', account_id: 'account-1' },
        },
        {
          id: 'alert-2',
          client_id: 'client-2',
          enabled_sov: true,
          sov_threshold: 40,
          enabled_wow: false,
          wow_threshold: 10,
          notify_email: true,
          notify_inapp: true,
          client: { id: 'client-2', brand_name: 'Bravo', account_id: 'account-1' },
        },
        {
          id: 'alert-3',
          client_id: 'client-3',
          enabled_sov: false,
          sov_threshold: 55,
          enabled_wow: true,
          wow_threshold: 8,
          notify_email: false,
          notify_inapp: true,
          client: { id: 'client-3', brand_name: 'Charlie', account_id: 'account-2' },
        },
      ],
      weeksByClient: {
        'client-1': [
          { client_id: 'client-1', scan_week: '2026-08-07', sov_score: 40 },
          { client_id: 'client-1', scan_week: '2026-07-31', sov_score: 55 },
        ],
        'client-2': [
          { client_id: 'client-2', scan_week: '2026-08-07', sov_score: 61 },
          { client_id: 'client-2', scan_week: '2026-07-31', sov_score: 63 },
        ],
        'client-3': [
          { client_id: 'client-3', scan_week: '2026-08-07', sov_score: 52 },
        ],
      },
      emailsByAccount: {
        'account-1': 'owner@example.com',
        'account-2': 'ops@example.com',
      },
      dashboardUrlByClient: {
        'client-1': 'https://app.example/en/dashboard/client-1',
        'client-2': 'https://app.example/en/dashboard/client-2',
        'client-3': 'https://app.example/en/dashboard/client-3',
      },
    })

    expect(state?.notificationUpserts).toEqual([
      {
        value: {
          account_id: 'account-1',
          client_id: 'client-1',
          type: 'sov_threshold',
          title: 'SoV Alert — Acme',
          message: 'SoV fell below 50% threshold (current: 40%).',
          read: false,
          scan_week: '2026-08-07',
        },
        options: {
          onConflict: 'client_id,type,scan_week',
          ignoreDuplicates: true,
        },
      },
    ])

    expect(h.sendAlertEmail).toHaveBeenCalledTimes(1)
    expect(h.sendAlertEmail).toHaveBeenCalledWith({
      to: 'owner@example.com',
      brandName: 'Acme',
      type: 'sov_threshold',
      currentSov: 40,
      previousSov: 55,
      threshold: 50,
      dashboardUrl: 'https://app.example/en/dashboard/client-1',
    })
  })

  it('pages config/profile/RPC reads so capped provider responses do not truncate the snapshot', async () => {
    const configRows = Array.from({ length: 1001 }, (_, index) => {
      const ordinal = index + 1
      return {
        id: `alert-${ordinal}`,
        client_id: `client-${ordinal}`,
        enabled_sov: true,
        sov_threshold: 50,
        enabled_wow: true,
        wow_threshold: 10,
        notify_email: true,
        notify_inapp: true,
        clients: {
          id: `client-${ordinal}`,
          brand_name: `Brand ${ordinal}`,
          account_id: `account-${ordinal}`,
        },
      }
    })
    const weeklySnapshotRows = configRows.flatMap(row => [
      { client_id: String(row.client_id), scan_week: '2026-08-07', sov_score: 40 },
      { client_id: String(row.client_id), scan_week: '2026-07-31', sov_score: 55 },
    ])
    const profileRows = configRows.map((row, index) => ({
      id: `profile-${index + 1}`,
      account_id: String(row.clients.account_id),
    }))
    const emailsByProfileId = Object.fromEntries(
      profileRows.map((profile, index) => [profile.id, `owner-${index + 1}@example.com`]),
    )

    h.createClient.mockImplementation(() => {
      const { client, state } = makeSupabaseStub({
        configRows,
        weeklySnapshotRows,
        profileRows,
        emailsByProfileId,
      })
      h.supabaseState = state
      return client
    })
    h.runAlertEvaluation.mockImplementation(async (ports: AlertEvaluationPorts) => {
      const snapshot = await ports.loadSnapshot()
      expect(snapshot.configs).toHaveLength(1001)
      expect(snapshot.weeksByClient['client-1']).toEqual([
        { client_id: 'client-1', scan_week: '2026-08-07', sov_score: 40 },
        { client_id: 'client-1', scan_week: '2026-07-31', sov_score: 55 },
      ])
      expect(snapshot.weeksByClient['client-1001']).toEqual([
        { client_id: 'client-1001', scan_week: '2026-08-07', sov_score: 40 },
        { client_id: 'client-1001', scan_week: '2026-07-31', sov_score: 55 },
      ])
      expect(snapshot.emailsByAccount['account-1001']).toBe('owner-1001@example.com')
      return { processed: snapshot.configs.length, fired: 0 }
    })

    const { POST } = await importRoute()
    const response = await POST(makeRequest('test-cron-secret'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ processed: 1001, fired: 0 })
    expect(h.supabaseState?.alertConfigRangeCalls).toEqual([
      { from: 0, to: 999 },
      { from: 1000, to: 1999 },
    ])
    expect(h.supabaseState?.weeklySnapshotRangeCalls).toEqual([
      { from: 0, to: 999 },
      { from: 1000, to: 1999 },
      { from: 2000, to: 2999 },
    ])
    expect(h.supabaseState?.profileRangeCalls).toEqual([
      { from: 0, to: 999 },
      { from: 1000, to: 1999 },
    ])
  })

  it('preserves the route failure behavior when snapshot loading throws', async () => {
    const snapshotError = new Error('snapshot unavailable')
    h.createClient.mockImplementation(() => {
      const { client, state } = makeSupabaseStub({ weeklySnapshotError: snapshotError })
      h.supabaseState = state
      return client
    })
    h.runAlertEvaluation.mockImplementation(async (ports: AlertEvaluationPorts) => {
      await ports.loadSnapshot()
      return { processed: 0, fired: 0 }
    })

    const { POST } = await importRoute()

    await expect(POST(makeRequest('test-cron-secret'))).rejects.toThrow('snapshot unavailable')
    expect(h.sendAlertEmail).not.toHaveBeenCalled()
    expect(h.supabaseState?.notificationUpserts).toEqual([])
  })
})
