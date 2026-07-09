import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NextIntlClientProvider } from 'next-intl'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { AgentCompetitor, LocalTrustAction, LocalTrustBucketScore, LocalTrustProfile, LocalTrustSnapshot } from '@/lib/types'

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: () => undefined,
  }),
}))

const repoRoot = process.cwd()

function read(path: string) {
  return readFileSync(join(repoRoot, path), 'utf8')
}

function messages(locale: 'en' | 'zh-HK') {
  return JSON.parse(read(`messages/${locale}.json`))
}

describe('Local Trust dashboard wiring', () => {
  it('adds ROI as the fifth dashboard workflow step', () => {
    const sidebar = read('components/dashboard/DashboardSidebar.tsx')
    const page = read('app/[lang]/dashboard/[clientId]/page.tsx')

    expect(sidebar).toContain("key: 'roi'")
    expect(sidebar.indexOf("key: 'monitor'")).toBeLessThan(sidebar.indexOf("key: 'roi'"))
    expect(sidebar).toContain('nav_roi')
    expect(sidebar).toContain('TrendingUp')
    expect(page).toContain("step === 'roi'")
    expect(page).toContain('LocalTrustStep')
  })

  it('keeps Local Trust ROI visible but locked for plans without access', () => {
    const sidebar = read('components/dashboard/DashboardSidebar.tsx')
    const progress = read('components/dashboard/WizardProgress.tsx')

    expect(sidebar).toContain("s.key === 'roi' && !features.local_trust_roi")
    expect(sidebar).toContain("const blocksNavigation = locked && s.key !== 'roi'")
    expect(sidebar).toContain('blocksNavigation')
    expect(progress).toContain("key: 'roi'")
    expect(progress).toContain('features.local_trust_roi')
    expect(progress).toContain('Local Trust ROI')
    expect(progress).toContain('Lock')
    expect(progress).not.toContain('🔒')
  })

  it('guards Local Trust snapshot generation to scans matching the current client domain', () => {
    const page = read('app/[lang]/dashboard/[clientId]/page.tsx')

    expect(page).toContain('findNewestMatchingScan')
    expect(page).toContain('const localTrustScanRows')
    expect(page).toContain('findNewestMatchingScan(localTrustScanRows, typedClient.domain)')
    expect(page).not.toContain('const localTrustScan = domainsMatch(scan?.domain, typedClient.domain) ? scan : null')
    expect(page).toContain('const localTrustCompetitors = localTrustScan')
    expect(page).toContain('localTrustScan.id === scan?.id ? agentCompetitors')
    expect(page).toContain('latestScan: localTrustScan')
    expect(page).toContain('competitors: localTrustCompetitors')
    expect(page).toContain('competitors={localTrustCompetitors}')
  })

  it('uses translated locked preview copy with sample movement and a pricing CTA', () => {
    const step = read('components/dashboard/local-trust/LocalTrustStep.tsx')
    const preview = read('components/dashboard/local-trust/LocalTrustLockedPreview.tsx')
    const en = read('messages/en.json')
    const zh = read('messages/zh-HK.json')

    expect(step).toContain("useTranslations('dashboard')")
    expect(step).toContain('LocalTrustLockedPreview')
    expect(step).toContain("t('local_trust_preview_body')")
    expect(step).toContain("t('local_trust_upgrade_cta')")
    expect(step).toContain("t('local_trust_sample_score')")
    expect(preview).toContain('62')
    expect(preview).toContain('71')
    expect(preview).toContain('`/${lang}/pricing`')
    expect(step).not.toContain('Preview how Pro turns')

    for (const messages of [en, zh]) {
      expect(messages).toContain('local_trust_preview_body')
      expect(messages).toContain('local_trust_upgrade_cta')
      expect(messages).toContain('local_trust_sample_score')
    }
  })

  it('fetches Local Trust data only for the ROI step using account-scoped helpers', () => {
    const page = read('app/[lang]/dashboard/[clientId]/page.tsx')

    expect(page).toContain("select('id, brand_name, domain, industry, competitors, status, created_at')")
    expect(page).toContain("getLocalTrustProfile(clientId, profile.account_id)")
    expect(page).toContain("step === 'roi' && features.local_trust_roi")
    expect(page).toContain('getOrCreateLocalTrustSnapshot')
    expect(page).toContain('accountId: profile.account_id')
    expect(page).toContain('const typedClient = client as Client')
    expect(page).toContain('client: typedClient')
  })

  it('does not create an integrated Local Trust snapshot without scan or aggregate Pulse baseline', () => {
    const page = read('app/[lang]/dashboard/[clientId]/page.tsx')

    expect(page).toContain('const hasAggregatePulseBaseline = summary.some(row => !row.platform)')
    expect(page).toContain('const hasLocalTrustBaseline = Boolean(localTrustScan || hasAggregatePulseBaseline)')
    expect(page).toContain("step === 'roi' && features.local_trust_roi && hasLocalTrustBaseline")
    expect(page).not.toContain('const hasLocalTrustBaseline = Boolean(localTrustScan || summary.length > 0)')
    expect(page).toContain('missed,')
    expect(page).toContain('snapshot={hasLocalTrustBaseline ? (localTrustData?.snapshot ?? null) : null}')
    expect(page).toContain('actions={hasLocalTrustBaseline ? (localTrustData?.actions ?? []) : []}')
  })

  it('contains English and Traditional Chinese Local Trust copy keys', () => {
    const en = read('messages/en.json')
    const zh = read('messages/zh-HK.json')

    for (const messages of [en, zh]) {
      expect(messages).toContain('step_roi_title')
      expect(messages).toContain('step_roi_body')
      expect(messages).toContain('step_roi_locked')
      expect(messages).toContain('nav_roi')
      expect(messages).toContain('nav_roi_desc')
      expect(messages).toContain('local_trust_score')
    }
  })
})

const bucketScores: LocalTrustBucketScore[] = [
  {
    key: 'local_visibility',
    label: 'Local visibility',
    score: 18,
    maxScore: 25,
    explanation: 'Good local service-area signals.',
    strongestSignal: 'Hong Kong service-area copy',
    weakestSignal: 'Local schema',
    topAction: 'Clarify priority services',
  },
  {
    key: 'proof_depth',
    label: 'Proof depth',
    score: 14,
    maxScore: 25,
    explanation: 'Proof is present but thin.',
    strongestSignal: 'Director credentials',
    weakestSignal: 'Client case studies',
    topAction: 'Add two client proof points',
  },
  {
    key: 'ai_answer_readiness',
    label: 'AI answer readiness',
    score: 20,
    maxScore: 25,
    explanation: 'Service content is easy to extract.',
    strongestSignal: 'Readable service pages',
    weakestSignal: 'Comparison FAQs',
    topAction: 'Add buyer FAQs',
  },
  {
    key: 'market_authority',
    label: 'Market authority',
    score: 19,
    maxScore: 25,
    explanation: 'Authority is improving.',
    strongestSignal: 'Pulse visibility',
    weakestSignal: 'Industry citations',
    topAction: 'Earn local citations',
  },
]

const snapshot: LocalTrustSnapshot = {
  id: 'snapshot-1',
  client_id: 'client-1',
  account_id: 'account-1',
  snapshot_month: '2026-06-01',
  local_trust_score: 71,
  bucket_scores: bucketScores,
  trust_gaps: [],
  roi_estimate: null,
  source_scan_id: 'scan-1',
  source_pulse_week: '2026-06-22',
  created_at: '2026-06-28T00:00:00.000Z',
}

const actions: LocalTrustAction[] = [
  {
    id: 'action-1',
    client_id: 'client-1',
    snapshot_id: 'snapshot-1',
    stable_key: 'proof_depth_case_studies',
    title: 'Add two client proof points',
    bucket: 'proof_depth',
    impact: 'high',
    effort: 'medium',
    status: 'open',
    created_at: '2026-06-28T00:00:00.000Z',
    updated_at: '2026-06-28T00:00:00.000Z',
  },
]

function localTrustProfile(overrides: Partial<LocalTrustProfile> = {}): LocalTrustProfile {
  return {
    id: 'profile-1',
    client_id: 'client-1',
    account_id: 'account-1',
    primary_services: ['AISO consulting'],
    service_area: 'Hong Kong',
    average_lead_value: 8000,
    close_rate: 0.25,
    competitors: ['rival.example'],
    created_at: '2026-06-28T00:00:00.000Z',
    updated_at: '2026-06-28T00:00:00.000Z',
    ...overrides,
  }
}

function responseJson(body: unknown, status = 200) {
  return Response.json(body, { status })
}

describe('Local Trust read-only UI components', () => {
  it('renders a Basic locked preview with sample movement and pricing CTA', async () => {
    const { LocalTrustLockedPreview } = await import('@/components/dashboard/local-trust/LocalTrustLockedPreview')

    const html = renderToStaticMarkup(<LocalTrustLockedPreview lang="en" />)

    expect(html).toContain('Local Trust ROI')
    expect(html).toContain('62')
    expect(html).toContain('71')
    expect(html).toContain('Upgrade to Pro')
    expect(html).toContain('/en/pricing')
  })

  it('renders overall score buckets with strongest, weakest, and top actions', async () => {
    const { LocalTrustScorePanel } = await import('@/components/dashboard/local-trust/LocalTrustScorePanel')

    const html = renderToStaticMarkup(<LocalTrustScorePanel score={71} buckets={bucketScores} />)

    expect(html).toContain('71')
    expect(html).toContain('Local visibility')
    expect(html).toContain('Proof depth')
    expect(html).toContain('Strongest')
    expect(html).toContain('Client case studies')
    expect(html).toContain('Add two client proof points')
  })

  it('summarizes the weakest bucket and first open action for owners', async () => {
    const { OwnerSummary } = await import('@/components/dashboard/local-trust/OwnerSummary')

    const html = renderToStaticMarkup(
      <OwnerSummary summary="Local trust score 71/100. Biggest gap: Proof depth - Add two client proof points. Next best action: Add two client proof points." />,
    )

    expect(html).toContain('Owner Summary')
    expect(html).toContain('71/100')
    expect(html).toContain('Biggest gap: Proof depth')
    expect(html).toContain('Next best action: Add two client proof points')
  })

  it('shows no-open-action copy and preserves bucket label casing', async () => {
    const { OwnerSummary } = await import('@/components/dashboard/local-trust/OwnerSummary')

    const html = renderToStaticMarkup(
      <OwnerSummary
        summary="Local trust score 71/100. Biggest gap: AI answer readiness - Add buyer FAQs. No open action available."
      />,
    )

    expect(html).toContain('AI answer readiness')
    expect(html).toContain('No open action available.')
    expect(html).not.toContain('ai answer readiness')
    expect(html).not.toContain('Next best action: Add two client proof points')
  })

  it('shows a no-estimate ROI prompt when assumptions are missing', async () => {
    const { RoiTimeline } = await import('@/components/dashboard/local-trust/RoiTimeline')

    const html = renderToStaticMarkup(<RoiTimeline snapshots={[snapshot]} />)

    expect(html).toContain('ROI Proof Timeline')
    expect(html).toContain('Jun 2026')
    expect(html).toContain('Add average lead value and close rate')
  })

  it('shows cautious ROI estimate ranges when assumptions exist', async () => {
    const { RoiTimeline } = await import('@/components/dashboard/local-trust/RoiTimeline')

    const html = renderToStaticMarkup(
      <RoiTimeline
        snapshots={[
          {
            ...snapshot,
            roi_estimate: {
              low: 12000,
              high: 28000,
              currency: 'HKD',
              assumptions: {
                averageLeadValue: 8000,
                closeRate: 0.2,
                estimatedExtraEnquiriesLow: 8,
                estimatedExtraEnquiriesHigh: 18,
              },
              confidence: 'directional',
            },
          },
        ]}
      />,
    )

    expect(html).toContain('Directional estimate')
    expect(html).toContain('HKD 12,000-28,000')
  })

  it('renders Enterprise report actions with an encoded export URL', async () => {
    const { ReportActions } = await import('@/components/dashboard/local-trust/ReportActions')

    const html = renderToStaticMarkup(<ReportActions clientId="client/1 #" />)

    expect(html).toContain('Export report')
    expect(html).toContain('Print report')
    expect(html).toContain('/api/dashboard/clients/client%2F1%20%23/local-trust/export')
  })

  it('renders competitor rows and a graceful empty state', async () => {
    const { CompetitorSnapshot } = await import('@/components/dashboard/local-trust/CompetitorSnapshot')
    const competitors: AgentCompetitor[] = [
      {
        id: 'competitor-1',
        scan_id: 'scan-1',
        platform: 'perplexity',
        competitor_domain: 'rival.example',
        competitor_name: 'Rival Advisory',
        mention_rate: 44,
        your_rate: 18,
        gap_analysis: 'Competitor has stronger local case-study proof.',
        created_at: '2026-06-28T00:00:00.000Z',
      },
    ]

    expect(renderToStaticMarkup(<CompetitorSnapshot competitors={competitors} />)).toContain('Rival Advisory')
    expect(renderToStaticMarkup(<CompetitorSnapshot competitors={[]} />)).toContain('Add competitors or run agent analysis')
  })

  it('localizes integrated score and owner summary copy instead of raw stored English', async () => {
    const { LocalTrustStep } = await import('@/components/dashboard/local-trust/LocalTrustStep')

    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="zh-HK" messages={messages('zh-HK')} timeZone="Asia/Hong_Kong">
        <LocalTrustStep
          lang="zh-HK"
          clientId="client-1"
          plan="pro"
          profile={null}
          snapshot={snapshot}
          actions={actions}
          competitors={[]}
        />
      </NextIntlClientProvider>,
    )

    expect(html).toContain('證明深度')
    expect(html).toContain('優先補強客戶證明')
    expect(html).toContain('本地信任評分 71/100。最大缺口是證明深度：優先補強客戶證明。下一步：優先補強客戶證明。')
    expect(html).not.toContain('Proof depth')
    expect(html).not.toContain('Proof is present but thin')
    expect(html).not.toContain('Director credentials')
    expect(html).not.toContain('Add two client proof points')
  })

  it('omits the Enterprise competitor placeholder for Pro users', async () => {
    const { LocalTrustStep } = await import('@/components/dashboard/local-trust/LocalTrustStep')

    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="en" messages={messages('en')} timeZone="Asia/Hong_Kong">
        <LocalTrustStep
          lang="en"
          clientId="client-1"
          plan="pro"
          profile={null}
          snapshot={snapshot}
          actions={actions}
          competitors={[]}
        />
      </NextIntlClientProvider>,
    )

    expect(html).not.toContain('Local Competitor Snapshot')
    expect(html).not.toContain('Available on Enterprise')
  })

  it('renders translated Enterprise report actions only when export is allowed', async () => {
    const { LocalTrustStep } = await import('@/components/dashboard/local-trust/LocalTrustStep')

    const enterpriseHtml = renderToStaticMarkup(
      <NextIntlClientProvider locale="zh-HK" messages={messages('zh-HK')} timeZone="Asia/Hong_Kong">
        <LocalTrustStep
          lang="zh-HK"
          clientId="client-1"
          plan="enterprise"
          profile={null}
          snapshot={snapshot}
          actions={actions}
          competitors={[]}
        />
      </NextIntlClientProvider>,
    )
    const proHtml = renderToStaticMarkup(
      <NextIntlClientProvider locale="en" messages={messages('en')} timeZone="Asia/Hong_Kong">
        <LocalTrustStep
          lang="en"
          clientId="client-1"
          plan="pro"
          profile={null}
          snapshot={snapshot}
          actions={actions}
          competitors={[]}
        />
      </NextIntlClientProvider>,
    )

    expect(enterpriseHtml).toContain('匯出報告')
    expect(enterpriseHtml).toContain('列印報告')
    expect(enterpriseHtml).toContain('/api/dashboard/clients/client-1/local-trust/export')
    expect(proHtml).not.toContain('Export report')
    expect(proHtml).not.toContain('/api/dashboard/clients/client-1/local-trust/export')
  })

  it('shows a read-only missing-data checklist when no snapshot exists', async () => {
    const { LocalTrustStep } = await import('@/components/dashboard/local-trust/LocalTrustStep')
    const profile: LocalTrustProfile = {
      id: 'profile-1',
      client_id: 'client-1',
      account_id: 'account-1',
      primary_services: ['AISO consulting'],
      service_area: null,
      average_lead_value: 5000,
      close_rate: null,
      competitors: ['rival.example'],
      created_at: '2026-06-28T00:00:00.000Z',
      updated_at: '2026-06-28T00:00:00.000Z',
    }

    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="en" messages={messages('en')} timeZone="Asia/Hong_Kong">
        <LocalTrustStep
          lang="en"
          clientId="client-1"
          plan="pro"
          profile={profile}
          snapshot={null}
          actions={[]}
          competitors={[]}
        />
      </NextIntlClientProvider>,
    )

    expect(html).toContain('Run first scan')
    expect(html).toContain('Primary services')
    expect(html).toContain('Service area')
    expect(html).toContain('Lead value and close rate')
    expect(html).toContain('Competitors')
    expect(html).toContain('Pulse visibility')
    expect(html).toContain('Found')
    expect(html).toContain('Missing')
  })
})

describe('Local Trust interactive controls', () => {
  it('renders setup form fields', async () => {
    const { LocalTrustSetupForm } = await import('@/components/dashboard/local-trust/LocalTrustSetupForm')

    const html = renderToStaticMarkup(<LocalTrustSetupForm clientId="client-1" profile={null} />)

    expect(html).toContain('name="primary_services"')
    expect(html).toContain('name="service_area"')
    expect(html).toContain('name="average_lead_value"')
    expect(html).toContain('name="close_rate"')
    expect(html).toContain('name="competitors"')
  })

  it('renders numeric setup fields with browser validation constraints', async () => {
    const { LocalTrustSetupForm } = await import('@/components/dashboard/local-trust/LocalTrustSetupForm')

    const html = renderToStaticMarkup(<LocalTrustSetupForm clientId="client-1" profile={localTrustProfile()} />)

    expect(html).toContain('name="average_lead_value"')
    expect(html).toContain('type="number"')
    expect(html).toContain('min="0"')
    expect(html).toContain('step="0.01"')
    expect(html).toContain('name="close_rate"')
    expect(html).toContain('max="1"')
  })

  it('submits setup values to the encoded profile route with normalized JSON', async () => {
    const { submitLocalTrustSetup } = await import('@/components/dashboard/local-trust/LocalTrustSetupForm')
    const fetcher = vi.fn().mockResolvedValue(responseJson({ profile: localTrustProfile() }))

    await submitLocalTrustSetup({
      clientId: 'client/1 #',
      values: {
        primaryServices: ' AISO consulting, , Local SEO ',
        serviceArea: ' Hong Kong ',
        averageLeadValue: '15000',
        closeRate: '0.25',
        competitors: ' Rival One, , Rival Two ',
      },
      errorMessage: 'Unable to save assumptions.',
      fetcher,
    })

    const [[url, init]] = fetcher.mock.calls as Array<[string, RequestInit]>
    expect(url).toBe('/api/dashboard/clients/client%2F1%20%23/local-trust/profile')
    expect(init.method).toBe('PUT')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(JSON.parse(String(init.body))).toEqual({
      primary_services: ['AISO consulting', 'Local SEO'],
      service_area: ' Hong Kong ',
      average_lead_value: 15000,
      close_rate: 0.25,
      competitors: ['Rival One', 'Rival Two'],
    })
  })

  it('does not submit invalid numeric setup assumptions', async () => {
    const { submitLocalTrustSetup } = await import('@/components/dashboard/local-trust/LocalTrustSetupForm')
    const fetcher = vi.fn()
    const setError = vi.fn()
    const setSaving = vi.fn()

    const result = await submitLocalTrustSetup({
      clientId: 'client-1',
      values: {
        primaryServices: 'AISO consulting',
        serviceArea: 'Hong Kong',
        averageLeadValue: '-50',
        closeRate: '1.5',
        competitors: 'rival.example',
      },
      errorMessage: 'Unable to save assumptions.',
      fetcher,
      onError: setError,
      onSavingChange: setSaving,
    })

    expect(result).toEqual({ ok: false, error: 'Unable to save assumptions.' })
    expect(fetcher).not.toHaveBeenCalled()
    expect(setError).toHaveBeenLastCalledWith('Unable to save assumptions.')
    expect(setSaving.mock.calls).toEqual([[true], [false]])
  })

  it('refreshes and reconciles setup fields from the returned saved profile', async () => {
    const { submitLocalTrustSetup } = await import('@/components/dashboard/local-trust/LocalTrustSetupForm')
    const refresh = vi.fn()
    const reconcile = vi.fn()
    const fetcher = vi.fn().mockResolvedValue(responseJson({
      profile: localTrustProfile({
        primary_services: ['AISO consulting'],
        service_area: null,
        average_lead_value: null,
        close_rate: 0.4,
        competitors: [],
      }),
    }))

    const result = await submitLocalTrustSetup({
      clientId: 'client-1',
      values: {
        primaryServices: 'AISO consulting',
        serviceArea: 'Hong Kong',
        averageLeadValue: '10000',
        closeRate: '0.4',
        competitors: 'rival.example',
      },
      errorMessage: 'Unable to save assumptions.',
      fetcher,
      onReconcile: reconcile,
      onRefresh: refresh,
    })

    expect(result.ok).toBe(true)
    expect(reconcile).toHaveBeenCalledWith({
      primaryServices: 'AISO consulting',
      serviceArea: '',
      averageLeadValue: '',
      closeRate: '0.4',
      competitors: '',
    })
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('reports setup non-OK responses and clears saving state', async () => {
    const { submitLocalTrustSetup } = await import('@/components/dashboard/local-trust/LocalTrustSetupForm')
    const fetcher = vi.fn().mockResolvedValue(responseJson({ error: 'Nope' }, 500))
    const setError = vi.fn()
    const setSaving = vi.fn()
    const refresh = vi.fn()

    const result = await submitLocalTrustSetup({
      clientId: 'client-1',
      values: {
        primaryServices: '',
        serviceArea: '',
        averageLeadValue: '',
        closeRate: '',
        competitors: '',
      },
      errorMessage: 'Unable to save assumptions.',
      fetcher,
      onError: setError,
      onSavingChange: setSaving,
      onRefresh: refresh,
    })

    expect(result.ok).toBe(false)
    expect(setError).toHaveBeenLastCalledWith('Unable to save assumptions.')
    expect(setSaving.mock.calls).toEqual([[true], [false]])
    expect(refresh).not.toHaveBeenCalled()
  })

  it('renders action status controls', async () => {
    const { TrustGapChecklist } = await import('@/components/dashboard/local-trust/TrustGapChecklist')

    const html = renderToStaticMarkup(
      <TrustGapChecklist
        clientId="client-1"
        actions={[{
          id: 'action-1',
          client_id: 'client-1',
          snapshot_id: 'snapshot-1',
          stable_key: 'add-local-proof',
          title: 'Add local proof',
          bucket: 'proof_depth',
          impact: 'high',
          effort: 'low',
          status: 'open',
          created_at: '',
          updated_at: '',
        }]}
      />,
    )

    expect(html).toContain('Add local proof')
    expect(html).toContain('Done')
    expect(html).toContain('Skip')
  })

  it('patches an encoded action route with the requested status', async () => {
    const { patchTrustGapActionStatus } = await import('@/components/dashboard/local-trust/TrustGapChecklist')
    const fetcher = vi.fn().mockResolvedValue(responseJson({ action: { ...actions[0], id: 'action/1 #', status: 'done' } }))
    const setPending = vi.fn()
    const setError = vi.fn()
    const setStatus = vi.fn()
    const refresh = vi.fn()

    const result = await patchTrustGapActionStatus({
      clientId: 'client/1 #',
      actionId: 'action/1 #',
      status: 'done',
      errorMessage: 'Unable to update action.',
      fetcher,
      isPending: () => false,
      setPending,
      setError,
      setStatus,
      onRefresh: refresh,
    })

    const [[url, init]] = fetcher.mock.calls as Array<[string, RequestInit]>
    expect(result.ok).toBe(true)
    expect(url).toBe('/api/dashboard/clients/client%2F1%20%23/local-trust/actions/action%2F1%20%23')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(String(init.body))).toEqual({ status: 'done' })
    expect(setStatus).toHaveBeenCalledWith('action/1 #', 'done')
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('keeps pending state per action and ignores duplicate clicks for the same action', async () => {
    const { patchTrustGapActionStatus } = await import('@/components/dashboard/local-trust/TrustGapChecklist')
    const pending = new Set<string>()
    const statuses = new Map<string, string>()
    const resolvers: Array<(response: Response) => void> = []
    const fetcher = vi.fn().mockImplementation(() => new Promise<Response>(resolve => {
      resolvers.push(resolve)
    }))

    const baseOptions = {
      clientId: 'client-1',
      status: 'done' as const,
      errorMessage: 'Unable to update action.',
      fetcher,
      isPending: (actionId: string) => pending.has(actionId),
      setPending: (actionId: string, isPending: boolean) => {
        if (isPending) pending.add(actionId)
        else pending.delete(actionId)
      },
      setError: vi.fn(),
      setStatus: (actionId: string, status: string) => {
        statuses.set(actionId, status)
      },
      onRefresh: vi.fn(),
    }

    const first = patchTrustGapActionStatus({ ...baseOptions, actionId: 'action-1' })
    const duplicate = patchTrustGapActionStatus({ ...baseOptions, actionId: 'action-1' })
    const secondAction = patchTrustGapActionStatus({ ...baseOptions, actionId: 'action-2' })

    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(await duplicate).toEqual({ ok: false, skipped: true })

    resolvers[0](responseJson({ action: { ...actions[0], status: 'done' } }))
    resolvers[1](responseJson({ action: { ...actions[0], id: 'action-2', status: 'done' } }))

    await Promise.all([first, secondAction])

    expect(pending.size).toBe(0)
    expect(statuses.get('action-1')).toBe('done')
    expect(statuses.get('action-2')).toBe('done')
  })

  it('records action update errors against the failing action only', async () => {
    const { patchTrustGapActionStatus } = await import('@/components/dashboard/local-trust/TrustGapChecklist')
    const pending = new Set<string>()
    const errors = new Map<string, string | null>()
    const fetcher = vi.fn().mockResolvedValue(responseJson({ error: 'Nope' }, 500))

    const result = await patchTrustGapActionStatus({
      clientId: 'client-1',
      actionId: 'action-1',
      status: 'skipped',
      errorMessage: 'Unable to update action.',
      fetcher,
      isPending: actionId => pending.has(actionId),
      setPending: (actionId, isPending) => {
        if (isPending) pending.add(actionId)
        else pending.delete(actionId)
      },
      setError: (actionId, message) => errors.set(actionId, message),
      setStatus: vi.fn(),
      onRefresh: vi.fn(),
    })

    expect(result.ok).toBe(false)
    expect(errors.get('action-1')).toBe('Unable to update action.')
    expect(errors.has('action-2')).toBe(false)
    expect(pending.has('action-1')).toBe(false)
  })

  it('keeps dynamic errors announced and restores visible focus styles', () => {
    const setupForm = read('components/dashboard/local-trust/LocalTrustSetupForm.tsx')
    const checklist = read('components/dashboard/local-trust/TrustGapChecklist.tsx')

    expect(setupForm).toContain('role="alert"')
    expect(setupForm).toContain('focus-visible:')
    expect(checklist).toContain('role="alert"')
    expect(checklist).toContain('focus-visible:')
  })
})
