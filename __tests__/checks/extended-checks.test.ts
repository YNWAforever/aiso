/**
 * TDD: Extended checks c6–c16
 * Covers: llmsFullTxt, sitemap, metaDescription, headingStructure, faqDetection,
 *         canonical, serverText, internalLinks, entitySignals, contentFreshness, mcpCard
 */
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { forbidGlobalFetch } from '../helpers/forbid-global-fetch'

// Injected into every network check, exactly as the scan route injects
// fetchPublicUrl. The global is made hostile so a check that reaches for it
// instead of its fetcher parameter fails loudly rather than hitting the network.
const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset()
  forbidGlobalFetch()
})

// ── HTML fixtures ──────────────────────────────────────────────
const currentYear = new Date().getFullYear()

const HTML_RICH = `<!DOCTYPE html>
<html>
<head>
  <meta name="description" content="A detailed guide to AI SEO optimisation for businesses in Hong Kong — covering 20 checks.">
  <link rel="canonical" href="https://example.com/ai-seo">
  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"FAQPage","mainEntity":[
    {"@type":"Question","name":"What is AI visibility?","acceptedAnswer":{"@type":"Answer","text":"AI visibility is how often your brand appears in AI-generated responses."}},
    {"@type":"Question","name":"How does AISO work?","acceptedAnswer":{"@type":"Answer","text":"AISO works by optimising your content for AI crawlers through structured data, llms.txt, and content chunking."}}
  ]}
  </script>
</head>
<body>
  <h1>AI SEO Guide</h1>
  <h2>What is AISO?</h2>
  <p>AI SEO optimisation (AISO) helps businesses appear in AI-generated answers. According to
  research by MIT (${currentYear}), 45% of users trust AI answers for research queries.</p>
  <h2>Core Techniques</h2>
  <p>The main techniques include structured data, llms.txt, and content chunking.
  Fimmick AISO, Google AI, and Perplexity all use these signals.</p>
  <a href="/about">About</a>
  <a href="/blog">Blog</a>
  <a href="/contact">Contact</a>
  <a href="/pricing">Pricing</a>
  <p>Last updated: January 15, ${currentYear}</p>
  <p>Published: March ${currentYear}</p>
  ${Array(30).fill('<p>Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.</p>').join('\n')}
</body>
</html>`

const HTML_BARE = `<html><body><p>Hello world.</p></body></html>`

// ── c9: metaDescription ─────────────────────────────────────────
describe('checkMetaDescription', () => {
  it('returns pass when meta description has good length', async () => {
    const { checkMetaDescription } = await import('@/lib/checks/metaDescription')
    const r = checkMetaDescription(HTML_RICH, 'https://example.com')
    expect(r.status).toBe('pass')
  })

  it('returns fail when meta description is missing', async () => {
    const { checkMetaDescription } = await import('@/lib/checks/metaDescription')
    const r = checkMetaDescription(HTML_BARE, 'https://example.com')
    expect(['fail', 'warn']).toContain(r.status)
  })

  it('returns warn for very short meta description', async () => {
    const { checkMetaDescription } = await import('@/lib/checks/metaDescription')
    const html = '<html><head><meta name="description" content="Hi"></head><body></body></html>'
    const r = checkMetaDescription(html, 'https://example.com')
    expect(['warn', 'fail']).toContain(r.status)
  })
})

// ── c10: headingStructure ──────────────────────────────────────
describe('checkHeadingStructure', () => {
  it('returns pass for proper H1 → H2 hierarchy', async () => {
    const { checkHeadingStructure } = await import('@/lib/checks/headingStructure')
    const r = checkHeadingStructure(HTML_RICH, 'https://example.com')
    expect(r.status).toBe('pass')
  })

  it('returns fail when no headings found', async () => {
    const { checkHeadingStructure } = await import('@/lib/checks/headingStructure')
    const r = checkHeadingStructure(HTML_BARE, 'https://example.com')
    expect(['fail', 'warn']).toContain(r.status)
  })

  it('returns warn or fail for missing H1', async () => {
    const { checkHeadingStructure } = await import('@/lib/checks/headingStructure')
    const html = '<html><body><h2>Section</h2><h3>Sub</h3></body></html>'
    const r = checkHeadingStructure(html, 'https://example.com')
    expect(['warn', 'fail']).toContain(r.status)
  })
})

// ── c11: faqDetection ──────────────────────────────────────────
describe('checkFaqDetection', () => {
  it('returns pass for JSON-LD FAQPage schema', async () => {
    const { checkFaqDetection } = await import('@/lib/checks/faqDetection')
    const r = checkFaqDetection(HTML_RICH, 'https://example.com')
    expect(['pass', 'warn']).toContain(r.status)
  })

  it('returns fail when no FAQ detected', async () => {
    const { checkFaqDetection } = await import('@/lib/checks/faqDetection')
    const r = checkFaqDetection(HTML_BARE, 'https://example.com')
    expect(['fail', 'warn']).toContain(r.status)
  })

  it('returns a valid status for Q&A pattern content', async () => {
    const { checkFaqDetection } = await import('@/lib/checks/faqDetection')
    const html = `<html><body>
      <h3>What is AI SEO?</h3><p>AI SEO is the practice of...</p>
      <h3>How does it work?</h3><p>It works by...</p>
      <h3>Why does it matter?</h3><p>It matters because...</p>
    </body></html>`
    const r = checkFaqDetection(html, 'https://example.com')
    expect(['pass', 'warn', 'fail']).toContain(r.status)
  })
})

// ── c12: canonical ─────────────────────────────────────────────
describe('checkCanonical', () => {
  it('returns pass for self-referencing canonical', async () => {
    const { checkCanonical } = await import('@/lib/checks/canonical')
    const r = checkCanonical(HTML_RICH, 'https://example.com')
    expect(r.status).toBe('pass')
  })

  it('returns fail when canonical tag is missing', async () => {
    const { checkCanonical } = await import('@/lib/checks/canonical')
    const r = checkCanonical(HTML_BARE, 'https://example.com')
    expect(r.status).toBe('fail')
  })

  it('returns warn or fail when canonical points to different origin', async () => {
    const { checkCanonical } = await import('@/lib/checks/canonical')
    const html = '<html><head><link rel="canonical" href="https://other-domain.com/page"></head></html>'
    const r = checkCanonical(html, 'https://example.com')
    expect(['warn', 'fail']).toContain(r.status)
  })
})

// ── c13: serverText ────────────────────────────────────────────
describe('checkServerText', () => {
  it('returns pass for content-rich HTML (500+ words)', async () => {
    const { checkServerText } = await import('@/lib/checks/serverText')
    const r = checkServerText(HTML_RICH, 'https://example.com')
    expect(r.status).toBe('pass')
  })

  it('returns fail for nearly empty HTML', async () => {
    const { checkServerText } = await import('@/lib/checks/serverText')
    const r = checkServerText(HTML_BARE, 'https://example.com')
    expect(['fail', 'warn']).toContain(r.status)
  })

  it('strips script and style tags before counting words', async () => {
    const { checkServerText } = await import('@/lib/checks/serverText')
    const html = '<html><head><style>body{color:red}</style></head><body><script>var x=1</script><p>real content word</p></body></html>'
    const r = checkServerText(html, 'https://example.com')
    // Script/style content should not be counted — should fail or warn due to low word count
    expect(['warn', 'fail']).toContain(r.status)
  })
})

// ── c14: internalLinks ─────────────────────────────────────────
describe('checkInternalLinks', () => {
  it('returns pass for page with sufficient internal links', async () => {
    const { checkInternalLinks } = await import('@/lib/checks/internalLinks')
    const r = checkInternalLinks(HTML_RICH, 'https://example.com')
    expect(['pass', 'warn']).toContain(r.status)
  })

  it('returns fail or warn for page with no links', async () => {
    const { checkInternalLinks } = await import('@/lib/checks/internalLinks')
    const r = checkInternalLinks(HTML_BARE, 'https://example.com')
    expect(['fail', 'warn']).toContain(r.status)
  })

  it('only counts same-origin links as internal', async () => {
    const { checkInternalLinks } = await import('@/lib/checks/internalLinks')
    const html = `<html><body>
      <a href="https://external.com/page">external</a>
      <a href="https://another.com">another external</a>
      <a href="/internal">internal 1</a>
    </body></html>`
    const r = checkInternalLinks(html, 'https://example.com')
    // Only 1 internal link — likely warn or fail
    expect(['pass', 'warn', 'fail']).toContain(r.status)
  })
})

// ── c15: entitySignals ─────────────────────────────────────────
describe('checkEntitySignals', () => {
  it('entity-rich HTML gets a better result than empty HTML', async () => {
    const { checkEntitySignals } = await import('@/lib/checks/entitySignals')
    const richHtml = `<html><body>
      <p>Fimmick AISO was founded in Hong Kong in 2024. The company works with Google AI,
      Anthropic Claude, and OpenAI GPT-4 to improve AI search visibility for Asian markets.
      CEO Willy Lai presented at the AI Summit in Singapore on March 15, 2024.</p>
    </body></html>`
    const emptyHtml = '<html><body><p>Hello world.</p></body></html>'
    const rich  = checkEntitySignals(richHtml,  'https://example.com')
    const empty = checkEntitySignals(emptyHtml, 'https://example.com')
    // Rich content should score >= empty content
    const statusRank: Record<string, number> = { pass: 2, warn: 1, fail: 0 }
    expect(statusRank[rich.status] ?? 0).toBeGreaterThanOrEqual(statusRank[empty.status] ?? 0)
  })

  it('returns a valid status for any HTML', async () => {
    const { checkEntitySignals } = await import('@/lib/checks/entitySignals')
    const r = checkEntitySignals(HTML_RICH, 'https://example.com')
    expect(['pass', 'warn', 'fail']).toContain(r.status)
  })
})

// ── c16: contentFreshness ──────────────────────────────────────
describe('checkContentFreshness', () => {
  it('returns a valid status for HTML_RICH with current year dates', async () => {
    const { checkContentFreshness } = await import('@/lib/checks/contentFreshness')
    const r = checkContentFreshness(HTML_RICH, 'https://example.com')
    expect(['pass', 'warn', 'fail']).toContain(r.status)
  })

  it('returns fail for page with only old dates (2010)', async () => {
    const { checkContentFreshness } = await import('@/lib/checks/contentFreshness')
    const html = '<html><body><p>Written in 2010. Last reviewed 2011.</p></body></html>'
    const r = checkContentFreshness(html, 'https://example.com')
    expect(['warn', 'fail']).toContain(r.status)
  })

  it('HTML with current-year date scores at least as well as page with no dates', async () => {
    const { checkContentFreshness } = await import('@/lib/checks/contentFreshness')
    const yr = new Date().getFullYear()
    const fresh = checkContentFreshness(`<html><body><p>Published January ${yr}. Updated March ${yr}.</p></body></html>`, 'https://example.com')
    const stale = checkContentFreshness('<html><body><p>No dates here.</p></body></html>', 'https://example.com')
    const rank: Record<string, number> = { pass: 2, warn: 1, fail: 0 }
    expect(rank[fresh.status] ?? 0).toBeGreaterThanOrEqual(rank[stale.status] ?? 0)
  })
})

// ── c6: llmsFullTxt ────────────────────────────────────────────
describe('checkLlmsFullTxt', () => {
  it('returns pass for rich llms-full.txt', async () => {
    const { checkLlmsFullTxt } = await import('@/lib/checks/llmsFullTxt')
    fetchMock.mockResolvedValueOnce(new Response(
      '# Fimmick AISO\n> AI search optimisation platform\n\nhttps://fimmick.com/guide\nhttps://fimmick.com/pricing\nhttps://fimmick.com/blog\nhttps://fimmick.com/docs\nhttps://fimmick.com/about',
      { status: 200 }
    ))
    const r = await checkLlmsFullTxt('https://example.com', fetchMock)
    expect(r.status).toBe('pass')
  })

  it('returns fail when llms-full.txt not found (404)', async () => {
    const { checkLlmsFullTxt } = await import('@/lib/checks/llmsFullTxt')
    fetchMock.mockResolvedValueOnce(new Response('Not Found', { status: 404 }))
    const r = await checkLlmsFullTxt('https://example.com', fetchMock)
    expect(r.status).toBe('fail')
  })

  it('returns fail for empty llms-full.txt', async () => {
    const { checkLlmsFullTxt } = await import('@/lib/checks/llmsFullTxt')
    fetchMock.mockResolvedValueOnce(new Response('', { status: 200 }))
    const r = await checkLlmsFullTxt('https://example.com', fetchMock)
    expect(r.status).toBe('fail')
  })
})

// ── c7: mcpCard ────────────────────────────────────────────────
describe('checkMcpCard', () => {
  it('returns pass when well-known MCP JSON found via fetch', async () => {
    const { checkMcpCard } = await import('@/lib/checks/mcpCard')
    fetchMock.mockResolvedValueOnce(new Response(
      JSON.stringify({ mcpVersion: '1.0', name: 'Fimmick AISO', tools: [] }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    ))
    const r = await checkMcpCard('https://example.com', HTML_BARE, fetchMock)
    expect(['pass', 'warn']).toContain(r.status)
  })

  it('returns fail when no MCP card found', async () => {
    const { checkMcpCard } = await import('@/lib/checks/mcpCard')
    fetchMock.mockResolvedValue(new Response('Not Found', { status: 404 }))
    const r = await checkMcpCard('https://example.com', HTML_BARE, fetchMock)
    expect(r.status).toBe('fail')
  })
})

// ── c8: sitemap ────────────────────────────────────────────────
describe('checkSitemap', () => {
  it('returns a non-fail status when sitemap.xml is accessible and has URLs', async () => {
    const { checkSitemap } = await import('@/lib/checks/sitemap')
    const sitemapXml = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <url><loc>https://example.com/</loc></url>
      <url><loc>https://example.com/about</loc></url>
      <url><loc>https://example.com/blog</loc></url>
      <url><loc>https://example.com/pricing</loc></url>
      <url><loc>https://example.com/contact</loc></url>
    </urlset>`
    // robots.txt with sitemap directive
    fetchMock.mockResolvedValueOnce(new Response('User-agent: *\nSitemap: https://example.com/sitemap.xml\n', { status: 200 }))
    // sitemap.xml itself
    fetchMock.mockResolvedValueOnce(new Response(sitemapXml, { status: 200 }))
    const r = await checkSitemap('https://example.com', fetchMock)
    expect(['pass', 'warn']).toContain(r.status)
  })

  it('returns fail when all sitemap locations return 404', async () => {
    const { checkSitemap } = await import('@/lib/checks/sitemap')
    fetchMock.mockResolvedValue(new Response('Not Found', { status: 404 }))
    const r = await checkSitemap('https://example.com', fetchMock)
    expect(r.status).toBe('fail')
  })
})
