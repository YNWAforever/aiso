import { describe, it, expect } from 'vitest'
import { checkChunkability } from '@/lib/checks/chunkability'

const HTML_CHUNKY = `<html><body>
<h2>What is AEO?</h2>
<p>AEO (Answer Engine Optimization) is the practice of optimizing content to be cited by AI systems. It involves structured data, clear headings, and factual content with data points. Unlike traditional SEO, AEO focuses on being the cited source rather than just being ranked by search engines.</p>
<h2>How does AEO differ from SEO?</h2>
<p>SEO targets search engine crawlers to rank pages. AEO targets AI language models to cite content. AEO requires: structured data markup, clear heading hierarchy, factual density, and citation-ready format with statistics and references.</p>
<h2>What tools support AEO?</h2>
<ul><li>JSON-LD schema markup</li><li>llms.txt protocol</li><li>Sitemap optimization</li></ul>
</body></html>`

describe('checkChunkability', () => {
  it('returns pass for well-chunked content', async () => {
    const r = await checkChunkability(HTML_CHUNKY, { industry: 'technology', region: 'global' })
    expect(r.status).toBe('pass')
    expect(r.geoDetails?.totalChunks).toBeGreaterThan(0)
  })
  it('returns fail for empty content', async () => {
    const r = await checkChunkability('<html><body></body></html>', { industry: 'technology', region: 'global' })
    expect(r.status).toBe('fail')
  })
})
