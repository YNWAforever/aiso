import { describe, expect, it } from 'vitest'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'
import { buildStudioDriveDoc } from '@/lib/conversation-studio/drive-doc'
import type { StudioReply } from '@/lib/conversation-studio/types'

const reply: StudioReply = {
  status: 'evidenced',
  template: null,
  observations: [{
    id: 'obs-1', question: 'Which bakery <script>x</script>?', platform: 'chatgpt', scanWeek: '2026-10-26',
    recordedAt: '2026-10-27T03:00:00Z', collectedAt: null, model: null, market: null, result: 'success',
    brandMentioned: true, excerpt: 'Quote & "more"',
    links: [
      { url: 'https://example.com/bread', title: 'Bread', kind: 'provider-citation' },
      { url: 'javascript:alert(1)', title: 'Bad', kind: 'text-link' },
    ],
    searchEvidence: null,
  } as unknown as StudioReply['observations'][number]],
  scan: null,
  researchSteps: [],
  coverage: { pulse: 'present', citations: 'present', scan: 'missing', live: 'unsupported' },
}
const base = { brandName: 'Example <Brand>', threadTitle: 'Sourdough thread', prompt: 'Where is <b>bread</b>?', reply, generatedAt: '2026-11-02T10:00:00.000Z' }

describe.each([['en', en], ['zh-HK', zh]] as const)('buildStudioDriveDoc in %s', (locale, messages) => {
  const copy = messages.conversationStudio
  const { name, html } = buildStudioDriveDoc({ ...base, locale })

  it('escapes every member-supplied value', () => {
    expect(html).not.toContain('<script>')
    expect(html).toContain('Which bakery &lt;script&gt;x&lt;/script&gt;?')
    expect(html).toContain('Where is &lt;b&gt;bread&lt;/b&gt;?')
    expect(html).toContain('Example &lt;Brand&gt;')
    expect(html).toContain('Quote &amp; &quot;more&quot;')
  })

  it('links only http(s) sources', () => {
    expect(html).toContain('<a href="https://example.com/bread">Bread</a>')
    expect(html).not.toContain('href="javascript:')
  })

  it('keeps the on-screen honesty caveats and provenance', () => {
    expect(html).toContain(copy.honesty.searchDemandPending)
    expect(html).toContain(copy.evidence.coverageMeaning.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!))
    expect(html).toContain(copy.honesty.missingIsNotZero)
    expect(html).toContain(copy.evidence.status.missing)
    expect(html).toContain(copy.drive.doc.provenance.replace(/'/g, '&#39;'))
    expect(html).toContain('obs-1')
    expect(html).toContain(`lang="${locale}"`)
  })

  it('names no evidence vendor and invents no amounts', () => {
    expect(html).not.toMatch(/DataForSEO|Firecrawl|\$\d/)
  })

  it('names the Doc from the thread and brand, bounded', () => {
    expect(name).toBe('Sourdough thread · Example <Brand>')
    const long = buildStudioDriveDoc({ ...base, locale, threadTitle: '香'.repeat(300) }).name
    expect(Array.from(long)).toHaveLength(200)
  })
})

it('says no sources rather than inventing any', () => {
  const { html } = buildStudioDriveDoc({ ...base, locale: 'en', reply: { ...reply, observations: [], status: 'insufficient' } })
  expect(html).toContain(en.conversationStudio.evidence.noSources)
  expect(html).toContain(en.conversationStudio.evidence.insufficient)
})
