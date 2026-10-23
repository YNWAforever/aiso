import { test, expect, type APIRequestContext } from '@playwright/test'
import { checkRobots } from '@/lib/checks/robots'
import { checkLlmsTxt } from '@/lib/checks/llmsTxt'
import { checkLlmsFullTxt } from '@/lib/checks/llmsFullTxt'
import { checkMcpCard } from '@/lib/checks/mcpCard'
import { checkMetaDescription } from '@/lib/checks/metaDescription'
import { checkHeadingStructure } from '@/lib/checks/headingStructure'
import { checkFaqDetection } from '@/lib/checks/faqDetection'
import { checkServerText } from '@/lib/checks/serverText'
import { checkInternalLinks } from '@/lib/checks/internalLinks'
import { checkEntitySignals } from '@/lib/checks/entitySignals'
import { checkContentFreshness } from '@/lib/checks/contentFreshness'
import { checkChunkability } from '@/lib/checks/chunkability'
import type { PublicUrlFetch } from '@/lib/security/public-url'

/**
 * The site passes its own checks (UX Phase 8), run against the pages this
 * build actually serves. Left out on purpose: c8 and c12 compare against the
 * configured public origin, which a test server does not run on; c17 scores
 * cited domains over the network; c18 and c19 need the LLM provider. Those
 * are verified on the deployed preview (docs/ux/phase-8/README.md).
 */
function fetcher(request: APIRequestContext): PublicUrlFetch {
  return (async (url: string) => {
    const response = await request.get(new URL(url).pathname, { failOnStatusCode: false })
    return new Response(new Uint8Array(await response.body()), { status: response.status(), headers: response.headers() })
  }) as unknown as PublicUrlFetch
}

for (const lang of ['en', 'zh-HK'] as const) {
  test(`home ${lang} passes its own checks`, async ({ request, baseURL }) => {
    const base = new URL(`/${lang}`, baseURL).toString()
    const fetch = fetcher(request)
    const html = await (await request.get(`/${lang}`)).text()
    const context = { industry: 'general_b2c', region: 'global' } as const

    const results = {
      c1_robots: await checkRobots(base, fetch),
      c2_llms_txt: await checkLlmsTxt(base, fetch),
      c6_llms_full_txt: await checkLlmsFullTxt(base, fetch),
      c7_mcp_card: await checkMcpCard(base, html, fetch),
      c9_meta_desc: checkMetaDescription(html, base),
      c10_headings: checkHeadingStructure(html, base),
      c11_faq: checkFaqDetection(html, base),
      c13_render: checkServerText(html, base),
      c14_internal_links: checkInternalLinks(html, base),
      c15_entity: checkEntitySignals(html, base),
      c16_freshness: checkContentFreshness(html, base),
      c20_chunkability: await checkChunkability(html, context),
    }
    const failing = Object.entries(results).filter(([, result]) => result.status !== 'pass').map(([key, result]) => `${key}: ${result.message}`)
    expect(failing).toEqual([])
  })
}
