import { it, expect, vi } from 'vitest'
import { CHECK_VERSIONS, type EvidenceCheckKey } from '@/lib/scan-evidence'
import { createPublicUrlFetcher, PublicUrlError } from '@/lib/security/public-url'
import { createScanEvidenceCapture } from '@/lib/scan-evidence-capture'
import { checkFactualDensity } from '@/lib/checks/factualDensity'
import { checkTopicalAuthority } from '@/lib/checks/topicalAuthority'
vi.mock('@/lib/openrouter', () => ({ callOpenRouter: vi.fn().mockRejectedValue(new Error('secret-provider-error')) }))
const lookup = async () => [{ address: '8.8.8.8', family: 4 as const }]
it('captures validated final origin without Response.url and isolates concurrent scans', async () => {
  const fetcher = createPublicUrlFetcher({ lookup, fetchImpl: async input => String(input).includes('/start') ? new Response(null, {status:302,headers:{location:'https://final.example/private?secret'}}) : new Response('secret', {headers:{'content-type':'text/html;secret','set-cookie':'secret','authorization':'secret'}}) })
  const a = createScanEvidenceCapture(fetcher), b = createScanEvidenceCapture(fetcher)
  const responses = await Promise.all([a.forCheck('page')('https://one.example/start'), b.forCheck('page')('https://two.example')])
  expect(responses[0].url).toBe('')
  expect(a.observations[0].target.origin).toBe('https://final.example')
  expect(b.observations[0].target.origin).toBe('https://two.example')
  expect(JSON.stringify(a.observations)).not.toContain('secret')
})
it('records rejected redirects and timeouts without altering rejection', async () => {
  const capture = createScanEvidenceCapture(createPublicUrlFetcher({lookup,fetchImpl:async()=>new Response(null,{status:302,headers:{location:'http://127.0.0.1/private'}})}))
  await expect(capture.forCheck('page')('https://example.com')).rejects.toThrow()
  expect(capture.observations[0].collection).toBe('blocked')
  const timeout = createScanEvidenceCapture(createPublicUrlFetcher({lookup:async()=>{throw new DOMException('secret','TimeoutError')}}))
  await expect(timeout.forCheck('page')('https://example.com')).rejects.toThrow()
  expect(timeout.observations[0].collection).toBe('failed')
})
it('reports internal provider fallback without changing benchmark output', async () => {
  const factual = await checkFactualDensity('<p>Example text</p>', {industry:'general_b2c',region:'global'})
  expect(factual.geoDetails?.uniquenessScore).toBe(50)
  expect(factual.diagnostic).toEqual({collection:'partial',reason:'provider-fallback'})
  const topical = await checkTopicalAuthority(['https://example.com/topic/article'], '', 'general_b2c')
  expect(topical.diagnostic).toEqual({collection:'partial',reason:'provider-fallback'})
})

it('keeps body-read failures, missing checks and assessment failures distinct', async () => {
  const capture = createScanEvidenceCapture(createPublicUrlFetcher({lookup, fetchImpl:async()=>new Response('ok')}))
  await capture.forCheck('page')('https://example.com')
  const missing = capture.checks([], ['c1_robots'])
  expect(missing.c1_robots?.collection).toBe('unknown')
  capture.failedRead('page')
  const records = capture.checks(Array.from({length:20}, () => ({status:'fulfilled' as const,value:{status:'fail' as const,message:'empty'}})), Object.keys(CHECK_VERSIONS) as EvidenceCheckKey[])
  expect(records.c10_headings?.collection).toBe('failed')
})
it('captures response size and caller abort rejection without raw errors', async () => {
  const capped = createScanEvidenceCapture(createPublicUrlFetcher({lookup, requestImpl:async()=>{throw new PublicUrlError('private','RESPONSE_TOO_LARGE')}}))
  await expect(capped.forCheck('page')('https://example.com')).rejects.toThrow()
  expect(capped.observations[0].collection).toBe('failed')
  const aborted = createScanEvidenceCapture(createPublicUrlFetcher({lookup, fetchImpl:vi.fn()}))
  await expect(aborted.forCheck('page')('https://example.com', {signal:AbortSignal.abort()})).rejects.toThrow()
  expect(aborted.observations[0].collection).toBe('failed')
  expect(JSON.stringify(capped.observations)).not.toContain('private')
})

it.each([404, 410])('treats HTTP %i as unavailable HTML but observable optional-resource absence', async status => {
  const { checkStructuredData } = await import('@/lib/checks/structuredData')
  const { checkExtractability } = await import('@/lib/checks/extractability')
  const { checkLlmsTxt } = await import('@/lib/checks/llmsTxt')
  const capture = createScanEvidenceCapture(createPublicUrlFetcher({lookup, fetchImpl:async()=>new Response('', {status})}))
  const values = await Promise.all([
    checkStructuredData('https://example.com', capture.forCheck('c4_structured_data')),
    checkExtractability('https://example.com', capture.forCheck('c5_extractability')),
    checkLlmsTxt('https://example.com', capture.forCheck('c2_llms_txt')),
  ])
  expect(values.map(value => value.status)).toEqual(['fail','fail','fail'])
  const records = capture.checks(values.map(value => ({status:'fulfilled' as const,value})), ['c4_structured_data','c5_extractability','c2_llms_txt'])
  for (const key of ['c4_structured_data','c5_extractability'] as const) {
    expect(records[key]?.collection).toBe('failed')
    expect(records[key]?.assessment).toBe('not-verifiable')
  }
  expect(records.c2_llms_txt).toMatchObject({collection:'complete',assessment:'fail'})
})

it('does not mark the MCP HTML fallback complete when page collection failed', async () => {
  const { checkMcpCard } = await import('@/lib/checks/mcpCard')
  const capture = createScanEvidenceCapture(createPublicUrlFetcher({lookup, fetchImpl:async()=>new Response('', {status:404})}))
  capture.failedRead('page')
  const value = await checkMcpCard('https://example.com', '', capture.forCheck('c7_mcp_card'))
  expect(value.status).toBe('fail')
  const records = capture.checks([{status:'fulfilled',value}], ['c7_mcp_card'])
  expect(records.c7_mcp_card).toMatchObject({collection:'partial',assessment:'not-verifiable'})
})

it('keeps a successful MCP endpoint verifiable without an HTML fallback', async () => {
  const { checkMcpCard } = await import('@/lib/checks/mcpCard')
  const capture = createScanEvidenceCapture(createPublicUrlFetcher({lookup, fetchImpl:async()=>new Response('{}')}))
  capture.failedRead('page')
  const value = await checkMcpCard('https://example.com', '', capture.forCheck('c7_mcp_card'))
  const records = capture.checks([{status:'fulfilled',value}], ['c7_mcp_card'])
  expect(records.c7_mcp_card).toMatchObject({collection:'complete',assessment:'pass'})
})
