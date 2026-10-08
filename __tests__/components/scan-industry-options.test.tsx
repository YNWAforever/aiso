import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import { ScanForm } from '@/components/home/ScanForm'
import { scoreLayer3 } from '@/lib/authority/layer3-industry'
import { buildScanEvidence } from '@/lib/scan-evidence'
import type { IndustryCode } from '@/lib/types'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

describe('public scan industry choices', () => {
  it.each([
    ['en', en],
    ['zh-HK', zh],
  ] as const)('uses the energy scoring pack for the displayed Energy choice (%s)', (lang, messages) => {
    const markup = renderToStaticMarkup(<NextIntlClientProvider locale={lang} messages={messages} timeZone="UTC">
      <ScanForm lang={lang} />
    </NextIntlClientProvider>)
    const options = [...markup.matchAll(/<option value="([^"]+)"[^>]*>([^<]+)<\/option>/g)]
    const energy = options.find(([, , label]) => label.replaceAll('&amp;', '&') === messages.home.industry_energy)
    expect(energy).toBeDefined()
    const submittedIndustry = energy![1] as IndustryCode
    expect(submittedIndustry).toBe('energy_utilities')
    expect(scoreLayer3('iea.org', submittedIndustry)).toMatchObject({ tier: 'tier1', score: 10 })
    const evidence = buildScanEvidence({
      requestedUrl: 'https://example.com', evaluatedUrl: 'https://example.com',
      industry: submittedIndustry, region: 'global', sitemapSource: 'fetched', checks: {},
    })
    expect(evidence.comparison.industry).toBe('energy_utilities')
  })
})
