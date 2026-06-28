import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NextIntlClientProvider } from 'next-intl'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { AgentCompetitor, LocalTrustAction, LocalTrustBucketScore, LocalTrustProfile, LocalTrustSnapshot } from '@/lib/types'

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

    expect(page).toContain('normalizeDomain')
    expect(page).toContain('domainsMatch')
    expect(page).toContain('const localTrustScan = domainsMatch(scan?.domain, typedClient.domain) ? scan : null')
    expect(page).toContain('const localTrustCompetitors = localTrustScan ? agentCompetitors : []')
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

    expect(page).toContain('const hasLocalTrustBaseline = Boolean(localTrustScan || summary.length > 0)')
    expect(page).toContain("step === 'roi' && features.local_trust_roi && hasLocalTrustBaseline")
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

    const html = renderToStaticMarkup(<OwnerSummary snapshot={snapshot} actions={actions} />)

    expect(html).toContain('Owner Summary')
    expect(html).toContain('71/100')
    expect(html).toContain('biggest gap is Proof depth')
    expect(html).toContain('Next best action: Add two client proof points')
  })

  it('shows no-open-action copy and preserves bucket label casing', async () => {
    const { OwnerSummary } = await import('@/components/dashboard/local-trust/OwnerSummary')
    const noOpenActions = actions.map(action => ({ ...action, status: 'done' as const }))
    const aiSnapshot: LocalTrustSnapshot = {
      ...snapshot,
      bucket_scores: [
        { ...bucketScores[2]!, score: 8, label: 'AI answer readiness' },
        { ...bucketScores[0]!, score: 20 },
      ],
    }

    const html = renderToStaticMarkup(
      <OwnerSummary
        snapshot={aiSnapshot}
        actions={noOpenActions}
        copy={{ noAction: 'No open action available.' }}
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
