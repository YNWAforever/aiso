import type { db } from '@/lib/db'
import { mergeCompetitorRefs, type CompetitorRef } from '@/lib/competitors/schema'
import { isoDate } from '@/lib/iso-date'

type Sql = ReturnType<typeof db>

/**
 * Share of voice per brand and per competitor, computed on read from
 * classified Pulse answers (GEO parity Step 6).
 *
 * Computed rather than rolled up: at most 30 prompts x 5 platforms x 8 weeks
 * of rows, so one read is cheap, and there is no second writer to keep in step
 * with pulse_metrics — which has no unique key and has been inflated by a
 * careless writer before (CLAUDE.md).
 *
 * An answer counts only when it was classified, has a non-blank body and a
 * definite brand decision: the same "successful" rule load-owned-pulse uses,
 * so this never disagrees with the Pulse page's own denominator. Each subject
 * counts at most once per answer, so naming HSBC twice is one mention.
 */

export const SOV_WEEKS = 8
const MAX_OTHER_BRANDS = 5
/** The all-platforms cell key. Platform keys never contain `*`. */
export const ALL_PLATFORMS = '*'

export type SovAnswer = {
  scan_week: string | Date
  platform: string
  prompt_id: string | null
  question: string | null
  brand_mentioned: boolean
  competitors_mentioned: string[] | null
}
export type SovCell = { mentions: number; answers: number; share: number | null }
export type SovSubject = {
  kind: 'brand' | 'competitor' | 'other'
  label: string
  /** cells[week][platform | ALL_PLATFORMS] */
  cells: Record<string, Record<string, SovCell>>
  /** Latest week minus the week before, in percentage points; null without two weeks. */
  change: number | null
}
export type SovPrompt = {
  promptId: string | null
  question: string
  answers: number
  brandMentions: number
  competitors: { label: string; mentions: number }[]
}
export type ShareOfVoiceView = { weeks: string[]; platforms: string[]; subjects: SovSubject[]; prompts: SovPrompt[] }

const key = (value: string) => value.normalize('NFKC').trim().toLowerCase()
const share = (mentions: number, answers: number) => answers ? Math.round((mentions / answers) * 1000) / 10 : null
const byMentionsThenLabel = (a: { label: string; mentions: number }, b: { label: string; mentions: number }) =>
  b.mentions - a.mentions || a.label.localeCompare(b.label)

export function buildShareOfVoice(input: { brandName: string; refs: CompetitorRef[]; answers: SovAnswer[] }): ShareOfVoiceView {
  const brandKey = key(input.brandName)
  const canonical = new Map<string, string>()
  for (const ref of input.refs) for (const form of [ref.name, ...ref.aliases]) if (form.trim()) canonical.set(key(form), ref.name)

  const answers = input.answers.map(a => ({ ...a, scan_week: isoDate(a.scan_week, '') })).filter(a => a.scan_week)
  const weeks = [...new Set(answers.map(a => a.scan_week))].sort().reverse().slice(0, SOV_WEEKS)
  const inWindow = answers.filter(a => weeks.includes(a.scan_week))
  const platforms = [...new Set(inWindow.map(a => a.platform))].sort()

  // Subjects each answer mentions: canonical competitor names and other names,
  // once per answer, never the brand itself.
  const otherLabels = new Map<string, string>()
  const mentionsOf = (a: SovAnswer) => {
    const labels = new Set<string>()
    for (const raw of a.competitors_mentioned ?? []) {
      if (typeof raw !== 'string' || !raw.trim()) continue
      const k = key(raw)
      if (k === brandKey) continue
      const configured = canonical.get(k)
      if (configured) { labels.add(configured); continue }
      if (!otherLabels.has(k)) otherLabels.set(k, raw.trim())
      labels.add(otherLabels.get(k)!)
    }
    return labels
  }
  const tagged = inWindow.map(a => ({ ...a, labels: mentionsOf(a) }))
  type Tagged = (typeof tagged)[number]

  const latest = weeks[0]
  const others = [...new Set(otherLabels.values())]
    .map(label => ({
      label,
      mentions: tagged.filter(a => a.scan_week === latest && a.labels.has(label)).length,
      total: tagged.filter(a => a.labels.has(label)).length,
    }))
    .sort((a, b) => b.mentions - a.mentions || b.total - a.total || a.label.localeCompare(b.label))
    .slice(0, MAX_OTHER_BRANDS)

  const subjects: { kind: SovSubject['kind']; label: string; hit: (a: Tagged) => boolean }[] = [
    { kind: 'brand', label: input.brandName, hit: a => a.brand_mentioned === true },
    ...input.refs.map(r => ({ kind: 'competitor' as const, label: r.name, hit: (a: Tagged) => a.labels.has(r.name) })),
    ...others.map(o => ({ kind: 'other' as const, label: o.label, hit: (a: Tagged) => a.labels.has(o.label) })),
  ]

  const cellFor = (rows: Tagged[], hit: (a: Tagged) => boolean): SovCell => {
    const mentions = rows.filter(hit).length
    return { mentions, answers: rows.length, share: share(mentions, rows.length) }
  }

  const built: SovSubject[] = subjects.map(({ kind, label, hit }) => {
    const cells: SovSubject['cells'] = {}
    for (const week of weeks) {
      const rows = tagged.filter(a => a.scan_week === week)
      cells[week] = { [ALL_PLATFORMS]: cellFor(rows, hit) }
      for (const platform of platforms) {
        const scoped = rows.filter(a => a.platform === platform)
        if (scoped.length) cells[week][platform] = cellFor(scoped, hit)
      }
    }
    const now = weeks[0] ? cells[weeks[0]][ALL_PLATFORMS].share : null
    const before = weeks[1] ? cells[weeks[1]][ALL_PLATFORMS].share : null
    return { kind, label, cells, change: now !== null && before !== null ? Math.round((now - before) * 10) / 10 : null }
  })

  const prompts: SovPrompt[] = []
  for (const a of tagged.filter(a => a.scan_week === latest)) {
    const question = (a.question ?? '').trim()
    let prompt = prompts.find(p => (a.prompt_id ? p.promptId === a.prompt_id : p.question === question))
    if (!prompt) { prompt = { promptId: a.prompt_id, question, answers: 0, brandMentions: 0, competitors: [] }; prompts.push(prompt) }
    prompt.answers += 1
    if (a.brand_mentioned) prompt.brandMentions += 1
    for (const label of a.labels) {
      const entry = prompt.competitors.find(c => c.label === label)
      if (entry) entry.mentions += 1
      else prompt.competitors.push({ label, mentions: 1 })
    }
  }
  for (const prompt of prompts) prompt.competitors.sort(byMentionsThenLabel)

  return { weeks, platforms, subjects: built, prompts }
}

/** A cell value a spreadsheet will not execute, quoted when it needs to be. */
function csvField(value: string | number | null): string {
  if (value === null) return ''
  let text = String(value)
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\r\n]|^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** Long format: one row per week x platform (or "all") x subject. */
export function shareOfVoiceCsv(view: ShareOfVoiceView): string {
  const lines = ['week,platform,subject,type,mentions,answers,share_percent']
  for (const week of view.weeks) {
    for (const platform of [ALL_PLATFORMS, ...view.platforms]) {
      for (const subject of view.subjects) {
        const cell = subject.cells[week]?.[platform]
        if (!cell) continue
        lines.push([week, platform === ALL_PLATFORMS ? 'all' : platform, subject.label, subject.kind, cell.mentions, cell.answers, cell.share]
          .map(csvField).join(','))
      }
    }
  }
  return lines.join('\r\n') + '\r\n'
}

/** Null when the client is not the account's. Every statement carries the account. */
export async function readShareOfVoice(sql: Sql, accountId: string, clientId: string): Promise<ShareOfVoiceView | null> {
  const [client] = await sql`select brand_name, competitors from clients where id = ${clientId} and account_id = ${accountId} limit 1`
  if (!client) return null
  const [competitorRows, answers] = await Promise.all([
    sql`
      select name, aliases from competitors
      where client_id = ${clientId} and account_id = ${accountId} and archived_at is null
      order by created_at, id
    `,
    sql`
      select m.scan_week, m.platform, m.prompt_id, coalesce(p.question, m.question) as question,
             m.brand_mentioned, m.competitors_mentioned
      from pulse_metrics m
      join clients c on c.id = m.client_id
      left join prompt_bank p on p.id = m.prompt_id and p.client_id = m.client_id
      where c.id = ${clientId} and c.account_id = ${accountId}
        and to_jsonb(m)->>'classification_status' = 'classified'
        and m.brand_mentioned is not null and m.raw_answer ~ '[^[:space:]]'
        and m.scan_week in (
          select distinct w.scan_week from pulse_metrics w
          where w.client_id = c.id order by 1 desc limit ${SOV_WEEKS}
        )
      order by m.scan_week desc, coalesce(p.question, m.question), m.platform
    `,
  ])
  return buildShareOfVoice({
    brandName: String(client.brand_name ?? ''),
    refs: mergeCompetitorRefs(client.competitors as unknown[] | null, competitorRows),
    answers: answers as SovAnswer[],
  })
}
