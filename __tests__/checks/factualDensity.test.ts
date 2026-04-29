import { describe, it, expect } from 'vitest'
import { checkFactualDensity } from '@/lib/checks/factualDensity'

const HTML_FACTUAL = `<html><body>
<p>In Q1 2024, revenue grew 23.4% to $4.2 billion, compared to $3.4 billion in Q1 2023.
The Harvard study in January 2024 included 12,000 participants across 15 countries.
Apple, Google, and Microsoft collectively hold 78% of the cloud market.</p>
</body></html>`

const HTML_VAGUE = `<html><body>
<p>Sales have been growing significantly. Our products are the best.
Many customers love what we do. We have been around for a long time.</p>
</body></html>`

describe('checkFactualDensity', () => {
  it('returns pass for factual content', async () => {
    const r = await checkFactualDensity(HTML_FACTUAL, { industry: 'finance', region: 'US' })
    expect(r.status).toBe('pass')
  }, 15_000)
  it('returns fail for vague content', async () => {
    const r = await checkFactualDensity(HTML_VAGUE, { industry: 'finance', region: 'US' })
    expect(['fail', 'warn']).toContain(r.status)
  }, 15_000)
})
