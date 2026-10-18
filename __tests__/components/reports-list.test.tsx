import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NextIntlClientProvider } from 'next-intl'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

const messages = JSON.parse(
  readFileSync(join(process.cwd(), 'messages/en.json'), 'utf8'),
)

describe('ReportsList', () => {
  it.each(['en', 'zh-HK'] as const)('shows distinct saved draft content and version timestamps in %s', async lang => {
    const { ReportsList } = await import('@/components/reports/ReportsList')
    const localized = JSON.parse(readFileSync(join(process.cwd(), `messages/${lang}.json`), 'utf8'))
    const reports = [
      { id: 'alpha', status: 'draft' as const, latestVersionNumber: 2, publishedVersionNumber: null,
        publishedAt: null, firstViewedAt: null, lastViewedAt: null, viewCount: 0, ctaClickCount: 0,
        savedAt: '2026-10-19T00:02:00.000Z', summaryPreview: 'SYNTHETIC ALPHA saved draft content.' },
      { id: 'beta', status: 'draft' as const, latestVersionNumber: 1, publishedVersionNumber: null,
        publishedAt: null, firstViewedAt: null, lastViewedAt: null, viewCount: 0, ctaClickCount: 0,
        savedAt: '2026-10-19T00:01:00.000Z', summaryPreview: 'SYNTHETIC BETA separate draft content.' },
      { id: 'legacy', status: 'draft' as const, latestVersionNumber: 1, publishedVersionNumber: null,
        publishedAt: null, firstViewedAt: null, lastViewedAt: null, viewCount: 0, ctaClickCount: 0 },
    ]
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale={lang} messages={localized} timeZone="Asia/Hong_Kong">
        <ReportsList lang={lang} clientId="synthetic-brand" clientName="SYNTHETIC brand"
          domain="fixture-aiso.example" reports={reports} />
      </NextIntlClientProvider>,
    )
    const items = html.split('<li>').slice(1)
    expect(items).toHaveLength(3)
    expect(items[0]).toContain('SYNTHETIC ALPHA saved draft content.')
    expect(items[0]).toContain('2026-10-19T00:02:00.000Z')
    expect(items[0]).toContain(`/${lang}/dashboard/synthetic-brand/reports/alpha`)
    expect(items[0]).not.toContain('SYNTHETIC BETA')
    expect(items[1]).toContain('SYNTHETIC BETA separate draft content.')
    expect(items[1]).toContain('2026-10-19T00:01:00.000Z')
    expect(items[1]).toContain(`/${lang}/dashboard/synthetic-brand/reports/beta`)
    expect(items[2]).toContain(localized.reports.unavailable)
    expect(items[2]).not.toContain('<time')
    expect(items[2]).not.toContain('SYNTHETIC ALPHA')
    expect(html).toContain(lang === 'en' ? 'Saved' : '儲存時間')
    expect(html).not.toContain('Open report')
  })
  it('renders every report state and accurate unavailable engagement metrics', async () => {
    const { ReportsList } = await import('@/components/reports/ReportsList')

    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="Asia/Hong_Kong">
        <ReportsList
          lang="en"
          clientId="client-1"
          clientName="Example Client"
          domain="example.com"
          reports={[
            {
              id: 'draft',
              status: 'draft',
              latestVersionNumber: 1,
              publishedVersionNumber: null,
              publishedAt: null,
              firstViewedAt: null,
              lastViewedAt: null,
              viewCount: 0,
              ctaClickCount: 0,
            },
            {
              id: 'published',
              status: 'published',
              latestVersionNumber: 1,
              publishedVersionNumber: 1,
              publishedAt: '2026-07-21T08:00:00.000Z',
              firstViewedAt: '2026-07-21T09:00:00.000Z',
              lastViewedAt: '2026-07-21T10:00:00.000Z',
              viewCount: 8,
              ctaClickCount: 3,
              signedUrl: 'https://reports.example/en/r/share?v=1&s=signature',
            },
            {
              id: 'changed',
              status: 'published',
              latestVersionNumber: 2,
              publishedVersionNumber: 1,
              publishedAt: '2026-07-21T08:00:00.000Z',
              firstViewedAt: null,
              lastViewedAt: null,
              viewCount: null,
              ctaClickCount: null,
              metricsUnavailable: true,
              signedUrl: 'https://reports.example/en/r/share?v=1&s=signature',
            },
            {
              id: 'revoked',
              status: 'revoked',
              latestVersionNumber: 2,
              publishedVersionNumber: 1,
              publishedAt: '2026-07-21T08:00:00.000Z',
              firstViewedAt: null,
              lastViewedAt: null,
              viewCount: 2,
              ctaClickCount: 0,
            },
          ]}
        />
      </NextIntlClientProvider>,
    )

    expect(html).toContain('Draft')
    expect(html).toContain('Published')
    expect(html).toContain('Published with unpublished changes')
    expect(html).toContain('Revoked')
    expect(html).toContain('Unavailable')
    expect(html).toContain('Latest version 2')
    expect(html).toContain('Published version 1')
    expect(html).toContain('Open report')
    expect(html).toContain('Edit report')
    expect(html).toContain('Copy link')
    expect(html).toContain('Rotate link')
    expect(html).toContain('Revoke report')
    expect(html).toContain('min-h-11')
    expect(html).not.toContain('Unavailable</dd><dd>0')
  })

  it('labels published reports with a newer draft without changing their live state', async () => {
    const { reportDisplayStatus } = await import('@/components/reports/ReportStatusBadge')

    expect(reportDisplayStatus({
      status: 'published',
      latestVersionNumber: 3,
      publishedVersionNumber: 2,
    })).toBe('published_with_changes')
    expect(reportDisplayStatus({
      status: 'published',
      latestVersionNumber: 2,
      publishedVersionNumber: 2,
    })).toBe('published')
    expect(reportDisplayStatus({
      status: 'revoked',
      latestVersionNumber: 2,
      publishedVersionNumber: 1,
    })).toBe('revoked')
  })
})
