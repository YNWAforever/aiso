import type { StudioEvidence, StudioReply, StudioTemplate } from './types'

const STOP_WORDS = new Set(['the', 'and', 'what', 'which', 'how', 'does', 'are', 'for', 'with', 'this', 'that', 'from', 'can', 'you', 'your', 'our', 'tell', 'about', 'please', 'today'])
function searchTerms(prompt: string): string[] {
  const words = prompt.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  return [...new Set(words.flatMap(word => {
    if (/\p{Script=Han}/u.test(word)) {
      const chars = Array.from(word)
      return chars.slice(0, -1).map((char, index) => char + chars[index + 1])
    }
    return word.length >= 3 && !STOP_WORDS.has(word) ? [word] : []
  }))]
}

/** Pure local extraction. A lexical match is never proof of an answer. */
export function composeSavedReply(prompt: string, template: StudioTemplate | null, data: StudioEvidence): StudioReply {
  const terms = searchTerms(prompt)
  const observations = template ? data.observations : data.observations.filter(item => {
    const text = `${item.question} ${item.excerpt ?? ''}`.toLowerCase()
    return terms.some(term => text.includes(term))
  })
  const scan = template === 'brief' || template === 'report' ? data.scan : null
  const usablePulse = observations.some(item => item.result === 'success' && !!item.excerpt)
  const usableScan = scan?.evidence.checks.some(check => check.collection === 'complete' && ['pass', 'warn', 'fail'].includes(check.assessment)) ?? false
  // Describe this local composition only. The page loaded the snapshot earlier;
  // neither a missing week nor an empty selection is a completed extraction.
  const researchSteps: StudioReply['researchSteps'] = []
  if (data.week && data.observations.length) researchSteps.push({ kind: 'loadWeek', week: data.week, count: data.totalRecorded })
  if (data.observations.length || scan) researchSteps.push({ kind: 'selectRecords' })
  if (observations.some(item => item.excerpt) || scan?.evidence.checks.length) researchSteps.push({ kind: 'composeExtracts' })
  return {
    // Arbitrary questions and verified comparisons need assessment beyond B1's extracts.
    status: template && template !== 'competitors' && (usablePulse || usableScan) ? 'evidenced' : 'insufficient',
    template, observations, scan, researchSteps,
    coverage: {
      pulse: observations.length ? 'present' : 'missing',
      citations: observations.some(item => item.links.some(link => link.kind === 'provider-citation')) ? 'present' : 'missing',
      scan: scan ? 'present' : 'missing', live: 'unsupported',
    },
  }
}
