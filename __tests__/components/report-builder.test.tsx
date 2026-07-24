import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NextIntlClientProvider } from 'next-intl'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ClientReportSnapshotV1 } from '@/lib/reports/types'

const messages = JSON.parse(
  readFileSync(join(process.cwd(), 'messages/en.json'), 'utf8'),
)

const snapshot: ClientReportSnapshotV1 = {
  snapshotSchemaVersion: 1,
  locale: 'en',
  branding: {
    agencyName: 'Acme Agency',
    logoUrl: null,
    primaryColor: '#123ABC',
    contactLabel: 'Contact us',
    contactUrl: 'https://agency.example/contact',
    attribution: 'Powered by Fimmick AISO',
  },
  client: { name: 'Example Client', domain: 'example.com' },
  evidence: {
    scanDate: '2026-07-21T08:00:00.000Z',
    evidenceTimestamp: '2026-07-21T08:00:00.000Z',
  },
  score: {
    current: 82,
    grade: 'A',
    comparisonState: 'comparable',
    previous: 75,
    delta: 7,
    previousScanDate: '2026-07-20T08:00:00.000Z',
  },
  changes: [
    { key: 'c1_robots', label: 'Robots access', kind: 'improved' },
    { key: 'c2_llms_txt', label: 'LLMs.txt', kind: 'unchanged' },
  ],
  priorityFixes: [
    {
      title: 'Clarify crawler access',
      rationale: 'Make crawler guidance explicit.',
      expectedImpact: 'high',
      nextStep: 'Review robots.txt directives.',
    },
  ],
  executiveSummary: 'The score improved to 82 with stronger crawler access.',
  methodology: 'Based only on checks captured in the selected scans.',
}

function provider(children: React.ReactNode) {
  return (
    <NextIntlClientProvider locale="en" messages={messages} timeZone="Asia/Hong_Kong">
      {children}
    </NextIntlClientProvider>
  )
}

describe('ReportBuilder', () => {
  it('renders the accessible three-step Compose, Review, Publish workflow', async () => {
    const { ReportBuilder } = await import('@/components/reports/ReportBuilder')

    const html = renderToStaticMarkup(provider(
      <ReportBuilder
        lang="en"
        clientId="client-1"
        scanId="scan-1"
        initialReport={null}
        initialSnapshot={snapshot}
      />,
    ))

    expect(html).toContain('aria-label="Report workflow progress"')
    expect(html).toContain('>Compose<')
    expect(html).toContain('>Review<')
    expect(html).toContain('>Publish<')
    expect(html).toContain('aria-current="step"')
    expect(html).toContain('for="report-executive-summary"')
    expect(html).toContain('<textarea')
    expect(html).toContain('Polish with AI')
    expect(html).toContain('Review report')
    expect(html).toContain('min-h-11')
    expect(html).toContain('focus-visible:')
    expect(html).toContain('aria-disabled="true"')
    expect(html).toContain('disabled=""')
  })

  it('distinguishes unsaved summaries and first-publish/update confirmations', async () => {
    const {
      hasUnsavedReportChanges,
      reportPublishConfirmation,
    } = await import('@/components/reports/ReportBuilder')

    expect(hasUnsavedReportChanges('Saved summary', 'Saved summary')).toBe(false)
    expect(hasUnsavedReportChanges('Saved summary', 'Edited summary')).toBe(true)
    expect(reportPublishConfirmation(null)).toBe('first')
    expect(reportPublishConfirmation({
      latestVersionNumber: 2,
      publishedVersionNumber: 1,
    })).toBe('update')
  })

  it('keeps AI fallback, unsaved navigation, clipboard, open-link, and lifecycle confirmations explicit', () => {
    const source = readFileSync(
      join(process.cwd(), 'components/reports/ReportBuilder.tsx'),
      'utf8',
    )
    const navigationSource = readFileSync(
      join(process.cwd(), 'lib/reports/navigation-blocker.ts'),
      'utf8',
    )

    expect(source).toContain('aria-live="polite"')
    expect(source).toContain('beforeunload')
    expect(source).toContain('installReportNavigationBlocker')
    expect(source).toContain('allowUnloadRef.current')
    expect(source).toContain('prepareFailOpen')
    expect(navigationSource).toContain('popstate')
    expect(navigationSource).toContain('prepareFailOpen?.()')
    expect(source).toContain('onNavigate')
    expect(source).toContain('navigator.clipboard.writeText')
    expect(source).toContain('window.open')
    expect(source).toContain("confirm(t('confirm_first_publish'))")
    expect(source).toContain("confirm(t('confirm_publish_update'))")
    expect(source).toContain("confirm(t('confirm_rotate'))")
    expect(source).toContain("confirm(t('confirm_revoke'))")
    expect(source).toContain("t('ai_fallback')")
    expect(source).toContain("t('unsaved_warning')")
  })

  it('binds review and publication to the same immutable saved version', () => {
    const source = readFileSync(
      join(process.cwd(), 'components/reports/ReportBuilder.tsx'),
      'utf8',
    )

    expect(source).toContain('reviewArtifact')
    expect(source).toContain('reviewedVersionId')
    expect(source).toContain('reviewedVersionId: reviewedArtifact.versionId')
    expect(source).not.toContain('const preview = withSummary(initialSnapshot, summary)')
  })

  it('preserves edits made while AI polish is in flight', async () => {
    const { shouldApplyAiSummary } = await import('@/components/reports/ReportBuilder')

    expect(shouldApplyAiSummary({
      startingSummary: 'Saved summary',
      currentSummary: 'Typed while waiting',
      startingRevision: 2,
      currentRevision: 3,
    })).toBe(false)
    expect(shouldApplyAiSummary({
      startingSummary: 'Saved summary',
      currentSummary: 'Saved summary',
      startingRevision: 2,
      currentRevision: 2,
    })).toBe(true)
  })

  it('renders the public-layout review from the API-safe snapshot', async () => {
    const { ReportPreview } = await import('@/components/reports/ReportPreview')

    const html = renderToStaticMarkup(provider(
      <ReportPreview
        snapshot={{
          ...snapshot,
          branding: {
            ...snapshot.branding,
            logoUrl: 'https://agency.example/private-logo.png',
          },
        }}
        logoProxyUrl="/api/client-reports/report-1/versions/version-1/logo"
        contactProxyUrl="/api/client-reports/report-1/versions/version-1/contact"
      />,
    ))

    expect(html).toContain('Example Client')
    expect(html).toContain('example.com')
    expect(html).toContain('82')
    expect(html).toContain('+7')
    expect(html).toContain('Clarify crawler access')
    expect(html).toContain('Powered by Fimmick AISO')
    expect(html).toContain('src="/api/client-reports/report-1/versions/version-1/logo"')
    expect(html).toContain('href="/api/client-reports/report-1/versions/version-1/contact"')
    expect(html).toContain('>Contact us<')
    expect(html).not.toContain('agency.example')
    expect(html).not.toMatch(/download|PDF|white-label/i)
  })
})
