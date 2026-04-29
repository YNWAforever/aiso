import { describe, it, expect } from 'vitest'
import { checkCitationDensity } from '@/lib/checks/citationDensity'

const HTML_RICH = `<html><body>
<p>According to <a href="https://nih.gov/study">NIH study</a>, 70% of adults...</p>
<p>The <a href="https://bloomberg.com/data">Bloomberg report</a> shows growth of 15%.</p>
<p>Research from <a href="https://reuters.com/article">Reuters</a> confirms trends.</p>
<p>Data source: <a href="https://worldbank.org/report">World Bank</a> (2024).</p>
<p>Statistics show 45% increase (source: <a href="https://statista.com">Statista</a>).</p>
<p>Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor.</p>
</body></html>`

const HTML_POOR = `<html><body><p>This page has no external links.</p></body></html>`

describe('checkCitationDensity', () => {
  it('returns pass for well-cited content', async () => {
    const result = await checkCitationDensity(HTML_RICH, 'https://example.com', { industry: 'finance', region: 'global' })
    expect(result.status).toBe('pass')
  }, 30_000)

  it('returns fail for uncited content', async () => {
    const result = await checkCitationDensity(HTML_POOR, 'https://example.com', { industry: 'finance', region: 'global' })
    expect(result.status).toBe('fail')
  }, 30_000)
})
