import type { StudioReply } from './types'

/**
 * Studio redesign R2: the conclusion that leads each answer (先講結論), shaped
 * by the skill the turn ran.
 *
 * Pure counting over the evidence the reply already carries. It never scores,
 * estimates or extrapolates: every number is a count of saved records in this
 * reply, and anything it cannot count is stated as not verifiable rather than
 * left out or filled in. Each line is a message key plus its values, so the
 * same facts render in both locales.
 */
export type ConclusionLine = { key: string; values?: Record<string, string | number> }
export type Conclusion = { headline: ConclusionLine; findings: ConclusionLine[] }

type Observation = StudioReply['observations'][number]

function mentionCounts(observations: Observation[]) {
  // Only a classified answer with text can say whether the brand appeared.
  const classified = observations.filter(item => item.result === 'success' && item.brandMentioned !== null)
  const mentioned = classified.filter(item => item.brandMentioned === true).length
  const platforms = [...new Set(classified.map(item => item.platform))].sort()
  return { classified: classified.length, mentioned, unclassified: observations.length - classified.length, platforms }
}

function scanCounts(scan: StudioReply['scan']) {
  const checks = scan?.evidence.checks.filter(check => check.collection === 'complete') ?? []
  const count = (assessment: string) => checks.filter(check => check.assessment === assessment).length
  return { fail: count('fail'), warn: count('warn'), pass: count('pass'), assessed: checks.length }
}

function pulseLines(reply: StudioReply): ConclusionLine[] {
  const counts = mentionCounts(reply.observations)
  if (!counts.classified) return [{ key: 'pulseNone' }]
  const lines: ConclusionLine[] = [{ key: 'pulseMentions', values: { mentioned: counts.mentioned, classified: counts.classified } }]
  lines.push({ key: 'pulsePlatforms', values: { platforms: counts.platforms.join(' · ') } })
  if (counts.unclassified) lines.push({ key: 'pulseUnclassified', values: { count: counts.unclassified } })
  return lines
}

function scanLines(reply: StudioReply): ConclusionLine[] {
  const counts = scanCounts(reply.scan)
  if (!counts.assessed) return [{ key: 'scanNone' }]
  return [
    { key: 'scanNeedsWork', values: { fail: counts.fail, warn: counts.warn } },
    { key: 'scanPassing', values: { pass: counts.pass, assessed: counts.assessed } },
  ]
}

export function composeConclusion(reply: StudioReply): Conclusion {
  switch (reply.template) {
    case 'opportunity': {
      const ready = reply.opportunities?.state === 'ready' ? reply.opportunities.suggestions.length : 0
      return ready
        ? { headline: { key: 'opportunityReady', values: { count: ready } }, findings: reply.opportunities?.pulseWeek ? [{ key: 'opportunityWeek', values: { week: reply.opportunities.pulseWeek } }] : [] }
        : { headline: { key: 'opportunityNone' }, findings: [] }
    }
    case 'pulse': {
      const [headline, ...findings] = pulseLines(reply)
      return { headline: headline!, findings }
    }
    // 'improve' runs the brief capability (HOME_TASKS), so it lands here too.
    case 'brief': {
      const [headline, ...findings] = scanLines(reply)
      return { headline: headline!, findings: [...findings, ...pulseLines(reply).filter(line => line.key !== 'pulseNone')] }
    }
    case 'report': {
      const scan = scanLines(reply), pulse = pulseLines(reply)
      return { headline: { key: reply.status === 'evidenced' ? 'reportReady' : 'reportInsufficient' }, findings: [...pulse, ...scan] }
    }
    case 'competitors':
      // Saved records carry no verified competitor measurement; say so first.
      return { headline: { key: 'competitorsUnverified' }, findings: pulseLines(reply).filter(line => line.key !== 'pulseNone') }
    default: {
      const matched = reply.observations.length
      return matched
        ? { headline: { key: 'questionMatched', values: { count: matched } }, findings: pulseLines(reply).filter(line => line.key !== 'pulseNone') }
        : { headline: { key: 'questionNone' }, findings: [] }
    }
  }
}
