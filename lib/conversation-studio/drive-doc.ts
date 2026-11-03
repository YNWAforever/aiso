import { createTranslator } from 'next-intl'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'
import type { StudioReply } from './types'
import { DRIVE_DOC_NAME_MAX } from '@/lib/integrations/google-drive/client'

export type DriveDocLocale = 'en' | 'zh-HK'

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ESCAPES[char]!)

function httpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch { return null }
}

/**
 * A saved Studio turn rendered as a self-contained HTML document for Drive to
 * convert. Only what the member already sees for that turn: the saved reply's
 * wording comes from the same message keys as StudioReplyView /
 * StudioSavedEvidence, every honesty caveat is kept, and every value is escaped.
 * No vendor payloads, no numbers that are not on screen, no vendor names.
 */
export function buildStudioDriveDoc(input: {
  locale: DriveDocLocale
  brandName: string
  threadTitle: string
  prompt: string
  reply: StudioReply
  generatedAt: string
}): { name: string; html: string } {
  const messages = input.locale === 'zh-HK' ? zh : en
  const t = createTranslator({ locale: input.locale, messages, namespace: 'conversationStudio' })
  const e = createTranslator({ locale: input.locale, messages, namespace: 'conversationStudio.evidence' })
  const { reply } = input
  const opportunityTask = reply.template === 'opportunity'
  const date = (value: string | null | undefined) => value ? esc(value) : esc(e('unknown'))
  const parts: string[] = []

  parts.push(`<h1>${esc(input.threadTitle)}</h1>`)
  parts.push(`<p>${esc(input.brandName)} · ${esc(t('drive.doc.generated', { time: input.generatedAt }))}</p>`)
  parts.push(`<h2>${esc(t('drive.doc.question'))}</h2><p>${esc(input.prompt)}</p>`)

  parts.push(`<h2>${esc(t('drive.doc.answer'))}</h2>`)
  parts.push(`<h3>${esc(opportunityTask ? t('templates.opportunity.label') : e(reply.status === 'evidenced' ? 'savedSummary' : 'insufficient'))}</h3>`)
  parts.push(`<p>${esc(opportunityTask ? t('templates.opportunity.limit') : e(reply.template === 'competitors' ? 'comparisonLimit' : reply.template ? 'summaryScope' : 'questionLimit'))}</p>`)
  parts.push(`<p><em>${esc(t('honesty.searchDemandPending'))}</em></p>`)

  if (opportunityTask && reply.opportunities?.state === 'ready') {
    if (reply.opportunities.partial && reply.opportunities.suggestions.length > 0) {
      parts.push(`<p>${esc(t('templates.opportunity.partial'))}</p>`)
    }
    parts.push('<ul>')
    for (const suggestion of reply.opportunities.suggestions) {
      const refs = suggestion.evidenceRefs.map(ref => `${e(ref.kind === 'pulse-metric' ? 'coverage.pulse' : 'coverage.scan')}: ${ref.id}${ref.checkKey ? ` · ${ref.checkKey}` : ''}`)
      parts.push(`<li><strong>${esc(suggestion.title)}</strong><br>${esc(suggestion.action)}<br>${esc(e('sourcesTitle'))}: ${esc(refs.join('; '))}</li>`)
    }
    parts.push('</ul>')
  } else if (opportunityTask && reply.opportunities) {
    const state = reply.opportunities.state === 'pending' ? 'pending' : 'empty'
    parts.push(`<p>${esc(t(`templates.opportunity.${state}`))}</p>`)
  }

  if (reply.template === 'report') {
    parts.push(`<p>${esc(e('reportDraft'))}</p>`)
  }

  if (reply.observations.length) {
    parts.push(`<h2>${esc(e('sourcesTitle'))}</h2><ol>`)
    for (const item of reply.observations) {
      const lines = [
        `<strong>${esc(item.question)}</strong>`,
        `${esc(item.platform)} · ${esc(item.scanWeek)} · ${esc(e(item.result === 'success' ? 'classified' : 'incomplete'))}`,
        `${esc(e('brandMention'))}: ${esc(e(item.brandMentioned === true ? 'mentionYes' : item.brandMentioned === false ? 'mentionNo' : 'unknown'))}`,
        item.excerpt ? `${esc(e('historicalQuote'))}<br><blockquote>${esc(item.excerpt)}</blockquote>` : esc(e('answerMissing')),
        `${esc(e('observationId'))}: ${esc(item.id)}`,
        `${esc(e('recordedAt'))}: ${date(item.recordedAt)} · ${esc(e('collectedAt'))}: ${date(item.collectedAt)}`,
        `${esc(e('search'))}: ${esc(e(item.searchEvidence?.execution === 'confirmed' ? 'searchConfirmed' : 'searchUnknown'))}`,
      ]
      const links = item.links.map(link => {
        const url = httpUrl(link.url)
        const label = esc(e(link.kind === 'provider-citation' ? 'providerCitation' : 'textLink'))
        return url ? `${label}: <a href="${esc(url)}">${esc(link.title || url)}</a>` : `${label}: ${esc(link.url)}`
      })
      lines.push(links.length ? links.join('<br>') : esc(e('citationsMissing')))
      parts.push(`<li>${lines.join('<br>')}</li>`)
    }
    parts.push('</ol>')
  } else if (!reply.scan) {
    parts.push(`<p>${esc(e('noSources'))}</p>`)
  }
  if (reply.scan) parts.push(`<p>${esc(e('scanId'))}: ${esc(reply.scan.id)} · ${esc(e('recordedAt'))}: ${date(reply.scan.recordedAt)}</p>`)

  parts.push(`<h2>${esc(e('coverageTitle'))}</h2><ul>`)
  for (const key of ['pulse', 'citations', 'scan', 'live'] as const) {
    parts.push(`<li>${esc(e(`coverage.${key}`))}: ${esc(e(`status.${reply.coverage[key]}`))}</li>`)
  }
  parts.push('</ul>')
  parts.push(`<p><em>${esc(e('coverageMeaning'))}</em></p>`)
  parts.push(`<p><em>${esc(t('honesty.missingIsNotZero'))}</em></p>`)
  parts.push(`<p><small>${esc(t('drive.doc.provenance'))}</small></p>`)

  const name = `${input.threadTitle} · ${input.brandName}`
  return {
    name: Array.from(name).slice(0, DRIVE_DOC_NAME_MAX).join(''),
    html: `<!doctype html><html lang="${input.locale}"><head><meta charset="utf-8"><title>${esc(input.threadTitle)}</title></head><body>${parts.join('')}</body></html>`,
  }
}
