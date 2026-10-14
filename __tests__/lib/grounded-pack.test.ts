import { describe, expect, it } from 'vitest'
import { buildGroundedFixPack } from '@/lib/fix/grounded-pack'

const schema = '<script type="application/ld+json">' + JSON.stringify({ '@type': 'FAQPage', mainEntity: [{ '@type': 'Question', name: 'What are the fees?', acceptedAnswer: { '@type': 'Answer', text: 'Withdrawals are free.' } }] }) + '</script>'
describe('active HTML grounding', () => {
  it('keeps decoded source text from closing the script element around the JSON-LD draft', () => {
    const encoded = '&lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt;'
    const sourceSchema = '<script type="application/ld+json">' + JSON.stringify({ '@type': 'FAQPage', mainEntity: [{ '@type': 'Question', name: 'What are the fees?', acceptedAnswer: { '@type': 'Answer', text: encoded } }] }) + '</script>'
    const pack = buildGroundedFixPack('https://example.com', '<p>What are the fees?</p><p>' + encoded + '</p>' + sourceSchema)
    expect(pack.faq_schema).not.toContain('</script>')
    expect(JSON.parse(pack.faq_schema).mainEntity[0].acceptedAnswer.text).toBe('</script><script>alert(1)</script>')
  })
  it('quotes active head metadata instead of commented, script or template metadata', () => {
    const html = '<!-- <title>Obsolete Bank</title><meta name="description" content="Withdrawals are free"> --><html><head><script>const example = "<title>Fake Bank</title>";</script><title>Bank</title><meta name="description" content="Check our fees"></head><body><template><title>Template Bank</title></template></body></html>'
    const pack = buildGroundedFixPack('https://example.com', html)
    expect(pack.llms_txt).toContain('"Bank"')
    expect(pack.llms_txt).toContain('"Check our fees"')
    expect(pack.llms_txt).not.toMatch(/Obsolete Bank|Fake Bank|Template Bank|Withdrawals are free/)
  })
  it.each(['hidden', 'style="display:none"', 'style="visibility:hidden"', 'aria-hidden="true"'])('rejects FAQ evidence from an explicitly hidden subtree: %s', attribute => {
    const pack = buildGroundedFixPack('https://example.com', '<div ' + attribute + '><h2>What are the fees?</h2><p>Withdrawals are free.</p></div>' + schema)
    expect(JSON.parse(pack.faq_schema).mainEntity).toEqual([])
  })
  it('retains exact visible source quotes and decoded metadata containing angle brackets', () => {
    const html = '<html><head><title>Bank &amp; Trust</title><meta content="Fees > zero" name="description"></head><body><h2>What are the fees?</h2><p>Withdrawals are free.</p>' + schema + '</body></html>'
    const pack = buildGroundedFixPack('https://example.com', html)
    expect(pack.llms_txt).toContain('"Bank & Trust"')
    expect(pack.llms_txt).toContain('"Fees > zero"')
    expect(JSON.parse(pack.faq_schema).mainEntity).toEqual([{ '@type': 'Question', name: 'What are the fees?', acceptedAnswer: { '@type': 'Answer', text: 'Withdrawals are free.' } }])
  })
})
