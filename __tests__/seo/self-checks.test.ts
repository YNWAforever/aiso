import { describe, expect, it } from 'vitest'
// Next's own serialiser, so the test reads the robots.txt the site really serves.
import { resolveRobots } from 'next/dist/build/webpack/loaders/metadata/resolve-route-data'
import robots from '@/app/robots'
import { GET as getLlmsTxt } from '@/app/llms.txt/route'
import { GET as getAiJson } from '@/app/.well-known/ai.json/route'
import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'
import { checkRobots } from '@/lib/checks/robots'
import { checkLlmsTxt } from '@/lib/checks/llmsTxt'
import { checkLlmsFullTxt } from '@/lib/checks/llmsFullTxt'
import { checkMcpCard } from '@/lib/checks/mcpCard'
import { checkMetaDescription } from '@/lib/checks/metaDescription'
import { checkEntitySignals } from '@/lib/checks/entitySignals'
import { checkContentFreshness } from '@/lib/checks/contentFreshness'
import { SITE_AI_ALLOWED_AGENTS } from '@/lib/robots-policy'
import { buildOrganizationJsonLd, buildSoftwareApplicationJsonLd, SITE_CONTENT_UPDATED } from '@/lib/seo'
import type { PublicUrlFetch } from '@/lib/security/public-url'

/**
 * The site must pass its own checks (UX Phase 8). Each one runs the real
 * check module against what the site itself serves, through a fetcher that
 * answers from the site's own route handlers. Page-level checks run against
 * the rendered pages in tests/e2e/self-checks.spec.ts.
 */
const BASE = 'https://aiso.example/en'

async function site(): Promise<PublicUrlFetch> {
  const files: Record<string, () => Promise<Response> | Response> = {
    '/robots.txt': () => new Response(resolveRobots(robots())),
    '/llms.txt': () => getLlmsTxt(),
    '/.well-known/ai.json': () => getAiJson(),
  }
  return (async (url: string) => {
    const serve = files[new URL(url).pathname]
    return serve ? serve() : new Response('', { status: 404 })
  }) as unknown as PublicUrlFetch
}

const jsonLd = (...blocks: unknown[]) =>
  blocks.map(block => `<script type="application/ld+json">${JSON.stringify(block)}</script>`).join('')

describe('the site passes its own checks', () => {
  it('c1: robots.txt names AI search and user agents, and blocks none', async () => {
    const text = resolveRobots(robots())
    for (const agent of SITE_AI_ALLOWED_AGENTS) expect(text).toContain(`User-Agent: ${agent}`)
    // Training crawlers stay under the wildcard rule (product decision).
    expect(text).not.toMatch(/User-Agent: (GPTBot|ClaudeBot|Google-Extended)/)
    expect(await checkRobots(BASE, await site())).toMatchObject({ status: 'pass', message: 'robots_ai_allowed' })
  })

  it('c2 and c6: llms.txt exists and links its pages', async () => {
    expect((await checkLlmsTxt(BASE, await site())).status).toBe('pass')
    expect(await checkLlmsFullTxt(BASE, await site())).toMatchObject({ status: 'pass', message: 'llms_full_txt_rich' })
  })

  it('c7: publishes ai.json, and it claims no API', async () => {
    expect(await checkMcpCard(BASE, '', await site())).toMatchObject({ status: 'pass', details: '/.well-known/ai.json' })
    const body = await (await getAiJson()).json()
    expect(body).toMatchObject({ name: 'Fimmick AISO', api: null })
    expect(JSON.stringify(body)).not.toMatch(/mcp|openapi|plugin/i)
  })

  it.each([['en', en], ['zh-HK', zhHK]] as const)('c9: every %s page description is 50–160 characters', (_locale, catalog) => {
    const descriptions: Array<[string, string]> = []
    const walk = (path: string, node: unknown) => {
      if (!node || typeof node !== 'object') return
      const { description } = node as { description?: unknown }
      if (typeof description === 'string') descriptions.push([path, description])
      for (const [key, child] of Object.entries(node)) walk(`${path}.${key}`, child)
    }
    walk('seo', catalog.seo)
    expect(descriptions.length).toBeGreaterThan(20)
    for (const [path, description] of descriptions) {
      // Escaped as React renders attributes; the check stops at a raw quote.
      const escaped = description.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;')
      const html = `<meta name="description" content="${escaped}">`
      expect({ path, ...checkMetaDescription(html, BASE) }).toMatchObject({ path, status: 'pass' })
    }
  })

  it('c15 and c16: names the company and dates the copy', () => {
    const html = jsonLd(buildSoftwareApplicationJsonLd('en'), buildOrganizationJsonLd())
    expect(checkEntitySignals(html, BASE)).toMatchObject({ status: 'pass', details: 'Organization' })
    expect(checkContentFreshness(html, BASE)).toMatchObject({ status: 'pass', details: SITE_CONTENT_UPDATED })
  })

  it('dates the copy with a real day that has already happened', () => {
    expect(SITE_CONTENT_UPDATED).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(new Date(SITE_CONTENT_UPDATED).getTime()).toBeLessThanOrEqual(Date.now())
  })
})
