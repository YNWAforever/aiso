import { describe, expect, it, vi } from 'vitest'
import { generateBrandDraft, parseBrandAssistInput } from '@/lib/onboarding/brand-assistant'

const input = { url: 'https://example.com/', language: 'zh-HK', market: 'HK' }
const html = '<html><script>secret script</script><title>Example</title><body><h1>Example workshops</h1><p>We teach design.</p></body></html>'
const draft = JSON.stringify({ brandName: 'Example', description: 'Design workshops.', industry: 'education' })

describe('brand assistant', () => {
  it('normalizes a domain but requires the customer to choose language and market', () => {
    expect(parseBrandAssistInput({ ...input, url: ' example.com/about?x=y#z ' })).toEqual(input)
    expect(() => parseBrandAssistInput({ ...input, market: null })).toThrow()
    expect(() => parseBrandAssistInput({ ...input, language: '' })).toThrow()
  })
  it.each(['https://user:pass@example.com', 'file:///etc/passwd', 'http://localhost', 'https://127.0.0.1', 'https://example.com:8443'])('rejects unsafe or credentialed URL %s', url => {
    expect(() => parseBrandAssistInput({ ...input, url })).toThrow()
  })
  it('returns an editable draft with source and chosen context, never model-supplied URLs or competitors', async () => {
    const generate = vi.fn().mockResolvedValue(draft)
    const result = await generateBrandDraft(parseBrandAssistInput(input), {
      fetchPage: async () => new Response(html, { headers: { 'content-type': 'text/html' } }), generate,
    })
    expect(result).toMatchObject({ brandName: 'Example', domain: 'example.com', industry: 'education', language: 'zh-HK', market: 'HK', sourceUrl: input.url })
    expect(result).not.toHaveProperty('competitors')
    expect(generate.mock.calls[0][0]).not.toContain('secret script')
    expect(generate).toHaveBeenCalledTimes(1)
  })
  it('does not send a failed or non-HTML fetch to the model', async () => {
    const generate = vi.fn()
    for (const response of [new Response('private', { status: 403 }), new Response('binary', { headers: { 'content-type': 'application/pdf' } })]) {
      await expect(generateBrandDraft(parseBrandAssistInput(input), { fetchPage: async () => response, generate })).rejects.toThrow()
    }
    expect(generate).not.toHaveBeenCalled()
  })
  it.each(['{}', '{"brandName":"","description":"a","industry":"education"}', '{"brandName":"Acme","description":"a","industry":"invented"}', JSON.stringify({ brandName: 'x'.repeat(161), description: 'a', industry: null })])('rejects unusable model output instead of saving it', async raw => {
    await expect(generateBrandDraft(parseBrandAssistInput(input), {
      fetchPage: async () => new Response(html, { headers: { 'content-type': 'text/html' } }), generate: async () => raw,
    })).rejects.toThrow()
  })
})
