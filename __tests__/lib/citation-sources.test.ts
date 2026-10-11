import { describe, it, expect } from 'vitest'
import { normalizeCitationUrl, registrableDomain } from '@/lib/citations/normalize'
import { classifyDomain } from '@/lib/citations/classify'
import { buildCitationReport, type CitationAnswer } from '@/lib/citations/report'

describe('normalizeCitationUrl', () => {
  it.each([
    ['https://WWW.Example.com/Page/?utm_source=x&b=2&gclid=y#top', 'https://example.com/Page?b=2'],
    ['https://example.com/', 'https://example.com/'],
    ['https://example.com/path/', 'https://example.com/path'],
    ['http://example.com/a?fbclid=1', 'http://example.com/a'],
  ])('%s → %s', (input, output) => {
    expect(normalizeCitationUrl(input)).toBe(output)
  })
  it.each(['javascript:alert(1)', 'ftp://example.com/x', 'not a url', ''])('refuses %j', input => {
    expect(normalizeCitationUrl(input)).toBeNull()
  })
})

describe('registrableDomain', () => {
  it.each([
    ['www.hsbc.com.hk', 'hsbc.com.hk'],
    ['personal.hsbc.com.hk', 'hsbc.com.hk'],
    ['news.bbc.co.uk', 'bbc.co.uk'],
    ['en.wikipedia.org', 'wikipedia.org'],
    ['example.com', 'example.com'],
    ['www.info.gov.hk', 'info.gov.hk'],
    ['localhost', 'localhost'],
  ])('%s → %s', (host, domain) => {
    expect(registrableDomain(host)).toBe(domain)
  })
})

describe('classifyDomain', () => {
  const context = {
    ownedDomains: ['fimmick.com'],
    competitors: [{ name: 'HSBC Holdings', domains: ['hsbc.com.hk'] }],
  }
  it.each([
    ['fimmick.com', 'owned'],
    ['blog.fimmick.com', 'owned'],
    ['personal.hsbc.com.hk', 'competitor'],
    ['www.reddit.com', 'forum'],
    ['lihkg.com', 'forum'],
    ['forum.example.org', 'forum'],
    ['www.instagram.com', 'social'],
    ['www.openrice.com', 'review'],
    ['www.tripadvisor.com.hk', 'review'],
    ['www.info.gov.hk', 'institutional'],
    ['www.hku.edu.hk', 'institutional'],
    ['www.scmp.com', 'editorial'],
    ['zh.wikipedia.org', 'editorial'],
    ['example.net', 'other'],
  ])('%s → %s', (host, kind) => {
    expect(classifyDomain(host, context).kind).toBe(kind)
  })
  it('names the competitor a domain belongs to', () => {
    expect(classifyDomain('hsbc.com.hk', context)).toEqual({ kind: 'competitor', competitor: 'HSBC Holdings' })
  })
  it('prefers owned over a list match, so a brand that is itself a news site stays owned', () => {
    expect(classifyDomain('www.scmp.com', { ownedDomains: ['scmp.com'], competitors: [] }).kind).toBe('owned')
  })
  it('does not treat a lookalike as a subdomain', () => {
    expect(classifyDomain('notfimmick.com', context).kind).toBe('other')
  })
})

describe('buildCitationReport', () => {
  const answer = (overrides: Partial<CitationAnswer>): CitationAnswer => ({
    scan_week: '2026-10-05', platform: 'gpt-4o', prompt_id: 'p1', question: 'Best bank?', provider_citations: [], ...overrides,
  })
  const context = { ownedDomains: ['fimmick.com'], competitors: [{ name: 'HSBC Holdings', domains: ['hsbc.com.hk'] }] }
  const report = buildCitationReport({
    context,
    answers: [
      answer({ provider_citations: [
        { url: 'https://www.hsbc.com.hk/rates?utm_source=x', title: 'Rates' },
        { url: 'https://hsbc.com.hk/rates', title: 'Rates again' },          // same URL once normalised
        { url: 'https://www.scmp.com/business/x', title: 'SCMP' },
      ] }),
      answer({ platform: 'gemini-flash', provider_citations: [{ url: 'https://personal.hsbc.com.hk/loans', title: null }] }),
      answer({ prompt_id: 'p2', question: 'Cheapest loan?', provider_citations: [{ url: 'https://fimmick.com/loans', title: 'Us' }] }),
      answer({ prompt_id: 'p2', question: 'Cheapest loan?', platform: 'gemini-flash', provider_citations: null }), // not recorded
      answer({ scan_week: '2026-09-28', provider_citations: [{ url: 'https://www.reddit.com/r/hk', title: 'r/hk' }] }),
    ],
  })

  it('counts answers per domain once, across subdomains, with its class', () => {
    expect(report.domains[0]).toEqual({
      domain: 'hsbc.com.hk', kind: 'competitor', competitor: 'HSBC Holdings',
      answers: 2, citations: 2, prompts: 1, platforms: ['gemini-flash', 'gpt-4o'],
    })
    expect(report.domains.map(d => d.domain)).toEqual(['hsbc.com.hk', 'fimmick.com', 'reddit.com', 'scmp.com'])
  })

  it('lists URLs normalised and de-duplicated within an answer', () => {
    expect(report.urls.find(u => u.url === 'https://hsbc.com.hk/rates')).toMatchObject({ answers: 1, kind: 'competitor', title: 'Rates' })
  })

  it('separates answers with no recorded citations from answers that cited nothing', () => {
    expect(report.answers).toEqual({ withCitations: 4, recordedEmpty: 0, unrecorded: 1 })
  })

  it('finds latest-week questions where a competitor is cited and you are not', () => {
    expect(report.gaps).toEqual([{ promptId: 'p1', question: 'Best bank?', competitors: ['HSBC Holdings'], domains: ['hsbc.com.hk'] }])
  })

  it('reports the weeks it covers, newest first, at most eight', () => {
    expect(report.weeks).toEqual(['2026-10-05', '2026-09-28'])
    const many = buildCitationReport({ context, answers: Array.from({ length: 10 }, (_, i) => answer({ scan_week: `2026-0${Math.floor(i / 3) + 1}-0${(i % 3) + 1}` })) })
    expect(many.weeks).toHaveLength(8)
  })

  it('ignores citations it cannot parse', () => {
    const bad = buildCitationReport({ context, answers: [answer({ provider_citations: [{ url: 'javascript:alert(1)' }, 'nope', null] as never })] })
    expect(bad.domains).toEqual([])
  })
})

describe('citation comparison prerequisites',()=>{
 const answers: CitationAnswer[]=[{scan_week:'2026-10-05',platform:'gpt-4o',prompt_id:'p',question:'Question',provider_citations:[]}];
 it.each([[[], 'not_configured'],[[{name:'Other',domains:[]}],'partial_config'],[[{name:'Other',domains:['other.example']}],'ready']] as const)('does not equate missing setup with no gap', (competitors,state)=>{expect(buildCitationReport({context:{ownedDomains:[],competitors:competitors.map(c=>({...c,domains:[...c.domains]}))},answers}).gapCoverage.state).toBe(state)});
 it('distinguishes fully configured with no observations',()=>{expect(buildCitationReport({context:{ownedDomains:[],competitors:[{name:'Other',domains:['other.example']}]},answers:[]}).gapCoverage.state).toBe('no_observations')});
});
