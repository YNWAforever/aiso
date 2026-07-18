import { describe, expect, it } from 'vitest'
import { generateMetadata as generateHomeMetadata } from '@/app/[lang]/layout'
import { generateMetadata as generatePricingMetadata } from '@/app/[lang]/pricing/layout'
import { GET as getLlmsTxt } from '@/app/llms.txt/route'

type MetadataGenerator = typeof generateHomeMetadata

function metadataProps(lang: string) {
  return {
    children: null,
    params: Promise.resolve({ lang }),
  }
}

function bulletsBetween(body: string, heading: string, nextHeading: string): string[] {
  const section = body.split(`${heading}\n`)[1]?.split(`\n\n${nextHeading}`)[0] ?? ''
  return section.split('\n').filter((line) => line.startsWith('- '))
}

async function expectLocalizedRoute(
  generateMetadata: MetadataGenerator,
  lang: 'en' | 'zh-HK',
  suffix: string,
) {
  const metadata = await generateMetadata(metadataProps(lang))
  const routeSuffix = `/${lang}${suffix}`

  expect(metadata.alternates?.canonical).toMatch(new RegExp(`${routeSuffix.replace('/', '\\/')}$`))
  expect(metadata.alternates?.languages).toMatchObject({
    en: expect.stringMatching(new RegExp(`/en${suffix}$`)),
    'zh-HK': expect.stringMatching(new RegExp(`/zh-HK${suffix}$`)),
    'x-default': expect.stringMatching(/\/$/),
  })
}

describe('localized metadata route wiring', () => {
  it.each(['en', 'zh-HK'] as const)('wires %s home metadata to the localized home', async (lang) => {
    await expectLocalizedRoute(generateHomeMetadata, lang, '')
  })

  it.each(['en', 'zh-HK'] as const)('wires %s pricing metadata to the localized pricing page', async (lang) => {
    await expectLocalizedRoute(generatePricingMetadata, lang, '/pricing')
  })

  it('rejects an unsupported locale before producing home metadata', async () => {
    await expect(generateHomeMetadata(metadataProps('fr'))).rejects.toThrow()
  })
})

describe('llms.txt discovery contract', () => {
  it('publishes exact product facts, cache headers, and localized public URLs', async () => {
    const response = await getLlmsTxt()
    const body = await response.text()

    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe('public, max-age=3600')
    expect(body).toContain('100 points')
    expect(bulletsBetween(body, '## Supported AI platforms', '## Fix Pack outputs')).toEqual([
      '- ChatGPT',
      '- Google AI',
      '- Perplexity',
      '- Claude',
      '- Gemini',
    ])
    expect(bulletsBetween(body, '## Fix Pack outputs', '## Public pages')).toEqual([
      '- llms.txt',
      '- robots.txt patch',
      '- FAQ JSON-LD',
    ])
    expect(body).toMatch(/\/en$/m)
    expect(body).toMatch(/\/en\/pricing$/m)
    expect(body).toMatch(/\/zh-HK$/m)
    expect(body).toMatch(/\/zh-HK\/pricing$/m)
  })
})
