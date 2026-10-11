import type { db } from '@/lib/db'
import { normalizeVerificationDomain } from '@/lib/domain-verification/schema'
import { isoDate } from '@/lib/iso-date'
import { classifyDomain, type CitationKind, type ClassifyContext } from '@/lib/citations/classify'
import { normalizeCitationUrl, registrableDomain } from '@/lib/citations/normalize'

type Sql = ReturnType<typeof db>

/**
 * Which sites and pages AI answers cite for a brand's questions, and whose
 * they are (GEO parity Step 4). Computed on read, like share of voice: at most
 * ~250 answers a week x 8 weeks, each with at most 50 stored provider
 * citations, so there is no rollup table to keep in step.
 *
 * Only provider citations count. URLs found in answer text are unverified and
 * stay out, so a site appears here because the model said it used it.
 */

export const CITATION_WEEKS = 8
const TOP = 50

export type CitationAnswer = {
  scan_week: string | Date
  platform: string
  prompt_id: string | null
  question: string | null
  provider_citations: unknown
}
export type CitationDomain = {
  domain: string; kind: CitationKind; competitor?: string
  answers: number; citations: number; prompts: number; platforms: string[]
}
export type CitationUrl = { url: string; title: string | null; domain: string; kind: CitationKind; competitor?: string; answers: number }
export type CitationGap = { promptId: string | null; question: string; competitors: string[]; domains: string[] }
export type CitationReport = {
  gapCoverage: {state:'not_configured'|'partial_config'|'no_observations'|'ready';configuredCompetitors:number;competitorsWithDomains:number}
  weeks: string[]
  /** recordedEmpty: the provider returned no usable citation. unrecorded: no citation envelope was stored at all. */
  answers: { withCitations: number; recordedEmpty: number; unrecorded: number }
  domains: CitationDomain[]
  urls: CitationUrl[]
  /** Latest week: questions whose answers cite a competitor and never the brand. */
  gaps: CitationGap[]
}

function citedUrls(value: unknown): Map<string, string | null> | null {
  if (!Array.isArray(value)) return null
  const urls = new Map<string, string | null>()
  for (const entry of value) {
    const url = normalizeCitationUrl((entry as { url?: unknown } | null)?.url)
    if (!url) continue
    const title = (entry as { title?: unknown }).title
    if (!urls.has(url) || (!urls.get(url) && typeof title === 'string' && title.trim())) {
      urls.set(url, typeof title === 'string' && title.trim() ? title.trim() : null)
    }
  }
  return urls
}

export function buildCitationReport(input: { context: ClassifyContext; answers: CitationAnswer[] }): CitationReport {
  const answers = input.answers.map(a => ({ ...a, scan_week: isoDate(a.scan_week, '') })).filter(a => a.scan_week)
  const weeks = [...new Set(answers.map(a => a.scan_week))].sort().reverse().slice(0, CITATION_WEEKS)
  const latest = weeks[0]
  const counts = { withCitations: 0, recordedEmpty: 0, unrecorded: 0 }
  const kinds = new Map<string, ReturnType<typeof classifyDomain>>()
  const kindOf = (host: string) => {
    if (!kinds.has(host)) kinds.set(host, classifyDomain(host, input.context))
    return kinds.get(host)!
  }

  const domains = new Map<string, CitationDomain & { promptKeys: Set<string>; platformSet: Set<string> }>()
  const urls = new Map<string, CitationUrl>()
  const latestByPrompt = new Map<string, { promptId: string | null; question: string; owned: boolean; competitors: Set<string>; domains: Set<string> }>()

  for (const a of answers) {
    if (!weeks.includes(a.scan_week)) continue
    const cited = citedUrls(a.provider_citations)
    if (cited === null) { counts.unrecorded += 1; continue }
    if (cited.size === 0) { counts.recordedEmpty += 1; continue }
    counts.withCitations += 1
    const promptKey = a.prompt_id ?? `q:${(a.question ?? '').trim()}`
    const seenDomains = new Map<string, number>()
    for (const [url, title] of cited) {
      const host = new URL(url).hostname
      const domain = registrableDomain(host)
      const kind = kindOf(host)
      seenDomains.set(domain, (seenDomains.get(domain) ?? 0) + 1)
      if (!domains.has(domain)) {
        domains.set(domain, { domain, kind: kind.kind, ...(kind.competitor ? { competitor: kind.competitor } : {}),
          answers: 0, citations: 0, prompts: 0, platforms: [], promptKeys: new Set(), platformSet: new Set() })
      }
      const u = urls.get(url) ?? { url, title, domain, kind: kind.kind, ...(kind.competitor ? { competitor: kind.competitor } : {}), answers: 0 }
      u.answers += 1
      if (!u.title && title) u.title = title
      urls.set(url, u)
      if (a.scan_week === latest) {
        const entry = latestByPrompt.get(promptKey) ?? { promptId: a.prompt_id, question: (a.question ?? '').trim(), owned: false, competitors: new Set(), domains: new Set() }
        if (kind.kind === 'owned') entry.owned = true
        if (kind.kind === 'competitor') { entry.competitors.add(kind.competitor!); entry.domains.add(domain) }
        latestByPrompt.set(promptKey, entry)
      }
    }
    for (const [domain, n] of seenDomains) {
      const d = domains.get(domain)!
      d.answers += 1
      d.citations += n
      d.promptKeys.add(promptKey)
      d.platformSet.add(a.platform)
    }
  }

  return {
    weeks,
    gapCoverage:{configuredCompetitors:input.context.competitors.length,competitorsWithDomains:input.context.competitors.filter(c=>c.domains.length>0).length,state:!input.context.competitors.length?'not_configured':input.context.competitors.some(c=>!c.domains.length)?'partial_config':counts.withCitations+counts.recordedEmpty===0?'no_observations':'ready'},
    answers: counts,
    domains: [...domains.values()]
      .map(({ promptKeys, platformSet, ...d }) => ({ ...d, prompts: promptKeys.size, platforms: [...platformSet].sort() }))
      .sort((a, b) => b.answers - a.answers || b.citations - a.citations || a.domain.localeCompare(b.domain))
      .slice(0, TOP),
    urls: [...urls.values()].sort((a, b) => b.answers - a.answers || a.url.localeCompare(b.url)).slice(0, TOP),
    gaps: [...latestByPrompt.values()]
      .filter(p => !p.owned && p.competitors.size > 0)
      .map(p => ({ promptId: p.promptId, question: p.question, competitors: [...p.competitors].sort(), domains: [...p.domains].sort() })),
  }
}

/** One row per cited site, for download. */
export function citationReportCsv(report: CitationReport): string {
  const field = (value: string | number) => {
    let text = String(value)
    if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  const lines = ['domain,type,competitor,answers,citations,questions,platforms']
  for (const d of report.domains) {
    lines.push([d.domain, d.kind, d.competitor ?? '', d.answers, d.citations, d.prompts, d.platforms.join(' ')].map(field).join(','))
  }
  return lines.join('\r\n') + '\r\n'
}

/** Null when the client is not the account's. Every statement carries the account. */
export async function readCitationReport(sql: Sql, accountId: string, clientId: string): Promise<CitationReport | null> {
  const [client] = await sql`select domain,competitors from clients where id = ${clientId} and account_id = ${accountId} limit 1`
  if (!client) return null
  const [verified, competitors, answers] = await Promise.all([
    sql`select domain from client_domain_verifications
        where account_id = ${accountId} and client_id = ${clientId} and verified_at is not null`,
    sql`select name, domains from competitors
        where client_id = ${clientId} and account_id = ${accountId} and archived_at is null`,
    // Provider citations from the ledger attempt when there is one, else the
    // row's own (062); the same precedence observation detail uses.
    sql`
      select m.scan_week, m.platform, m.prompt_id, coalesce(p.question, m.question) as question,
             coalesce(a.provider_citations, m.provider_citations) as provider_citations
      from pulse_metrics m
      join clients c on c.id = m.client_id and (m.run_item_id is null or exists(select 1 from pulse_run_items scope_item join pulse_runs scope_run on scope_run.id=scope_item.run_id and scope_run.account_id=scope_item.account_id and scope_run.client_id=scope_item.client_id where scope_item.id=m.run_item_id and scope_item.client_id=m.client_id and scope_run.purpose='canonical'))
      left join prompt_bank p on p.id = m.prompt_id and p.client_id = m.client_id
      left join pulse_run_items i on i.id = m.run_item_id and i.client_id = c.id and i.account_id = c.account_id
      left join pulse_item_attempts a on a.id = i.accepted_attempt_id and a.item_id = i.id and a.account_id = c.account_id
      where c.id = ${clientId} and c.account_id = ${accountId} and m.raw_answer ~ '[^[:space:]]'
        and m.scan_week in (
          select distinct w.scan_week from pulse_metrics w where w.client_id = c.id and (w.run_item_id is null or exists(select 1 from pulse_run_items scope_item join pulse_runs scope_run on scope_run.id=scope_item.run_id and scope_run.account_id=scope_item.account_id and scope_run.client_id=scope_item.client_id where scope_item.id=w.run_item_id and scope_item.client_id=w.client_id and scope_run.purpose='canonical')) order by 1 desc limit ${CITATION_WEEKS}
        )
      order by m.scan_week desc, coalesce(p.question, m.question), m.platform
    `,
  ])
  const owned = [normalizeVerificationDomain(client.domain as string | null), ...verified.map(v => normalizeVerificationDomain(v.domain as string))]
    .filter((d): d is string => !!d)
    .map(d => d.replace(/^www\./, ''))
  return buildCitationReport({
    context: {
      ownedDomains: [...new Set(owned)],
      competitors: [...competitors.map(c => ({ name: String(c.name), domains: Array.isArray(c.domains) ? c.domains.filter((d): d is string => typeof d === 'string') : [] })),...(Array.isArray(client.competitors)?client.competitors:[]).filter((n):n is string=>typeof n==='string'&&!!n.trim()&&!competitors.some(c=>String(c.name).toLowerCase()===n.trim().toLowerCase())).map(name=>({name,domains:[]}))],
    },
    answers: answers as CitationAnswer[],
  })
}
