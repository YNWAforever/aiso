import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import { ObservationWorkspace, type ObservationCopy } from '@/components/observations/ObservationWorkspace'
import { ObservationDetailContent } from '@/components/observations/ObservationDetail'
import type { ObservationResponse } from '@/lib/observations/types'
import { projectObservationDetail } from '@/lib/observations/schema'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'

const clientId = '11111111-1111-4111-8111-111111111111'
const promptId = '22222222-2222-4222-8222-222222222222'
const copyFor = (lang: string) =>
  (lang === 'en' ? en : zh).observations as ObservationCopy

const withAnswers: ObservationResponse = {
  schemaVersion: 1,
  clientId,
  selectedWeek: '2026-11-09',
  weeks: ['2026-11-09'],
  questionsTruncated: false,
  questions: [
    { id: promptId, question: '香港邊度可以沖洗菲林相？', category: 'category_query', language: 'zh-HK', isActive: true },
    { id: '44444444-4444-4444-8444-444444444444', question: 'FOTOMAX 同其他沖印店有咩分別？', category: 'brand_query', language: 'zh-HK', isActive: false },
  ],
  items: [
    {
      id: '33333333-3333-4333-8333-333333333333',
      sourceKind: 'pulse-metric',
      promptId,
      question: '香港邊度可以沖洗菲林相？',
      platform: 'ChatGPT',
      scanWeek: '2026-11-09',
      recordedAt: '2026-11-10T10:00:00Z',
      collectedAt: '2026-11-10T09:00:00Z',
      model: 'gpt-4.1',
      market: 'zh-HK',
      result: 'success',
      hasAnswer: true,
      brandMentioned: true,
      currentPrompt: null,
      limitations: [],
    },
    {
      id: '55555555-5555-4555-8555-555555555555',
      sourceKind: 'pulse-metric',
      promptId,
      question: '香港邊度可以沖洗菲林相？',
      platform: 'Gemini',
      scanWeek: '2026-11-09',
      recordedAt: '2026-11-10T11:00:00Z',
      collectedAt: null,
      model: null,
      market: null,
      result: 'incomplete',
      hasAnswer: false,
      brandMentioned: null,
      currentPrompt: null,
      limitations: ['model-unrecorded'],
    },
  ],
  counts: { recordedRows: 2, successfulRows: 1, incompleteRows: 1 },
  nextCursor: null,
}

const noAnswers: ObservationResponse = {
  ...withAnswers,
  weeks: [],
  selectedWeek: null,
  items: [],
  counts: { recordedRows: 0, successfulRows: 0, incompleteRows: 0 },
}

const propsFor = (lang: string, initial: ObservationResponse) => ({
  clientId,
  initial,
  copy: copyFor(lang),
  lang,
  smeCopilot: true,
})

describe('SME observation page', () => {
  it.each(['en', 'zh-HK'])('leads with plain language and hides raw evidence jargon in %s', lang => {
    const copy = copyFor(lang)
    const html = renderToString(<ObservationWorkspace {...propsFor(lang, withAnswers)} />)
    expect(html).toContain(copy.smeTitle)
    expect(html).toContain(copy.smeDescription)
    expect(html).toContain(copy.smeAnswersTitle)
    expect(html).toContain(copy.smeRecorded)
    expect(html).toContain(copy.smeMentioned)
    expect(html).toContain(copy.smeComplete)
    expect(html).toContain(copy.smeViewAnswer)
    expect(html).toContain(copy.smeDetails)
    // The old flat list of category/language codes is gone from the designed view.
    expect(html).not.toContain('category_query')
    expect(html).not.toContain('brand_query')
    expect(html).not.toContain('zh-HK</p>')
    expect(html).not.toContain(copy.historicalQuestion)
  })

  it.each(['en', 'zh-HK'])('explains an empty record without pretending there is data in %s', lang => {
    const copy = copyFor(lang)
    const html = renderToString(<ObservationWorkspace {...propsFor(lang, noAnswers)} />)
    expect(html).toContain(copy.smeNoRecordsTitle)
    expect(html).toContain(copy.smeNoRecordsBody)
    expect(html).toContain(copy.smeMonitoringStatus)
    expect(html).toContain(`href="/${lang}/dashboard/${clientId}?step=monitor#first-monitoring"`)
    // Monitored questions stay reachable, collapsed, with plain status words.
    expect(html).toContain(copy.smeMonitoringTitle)
    expect(html).toContain(copy.smeActive)
    expect(html).toContain(copy.smeInactive)
  })

  it('keeps an explicitly selected run when checking status without treating the empty week as the current week', () => {
    const html = renderToString(<ObservationWorkspace {...propsFor('en', noAnswers)} initialFilters={{ run: 'saved-run', week: '2026-10-05' }} />)
    expect(html).toContain(`href="/en/dashboard/${clientId}?step=monitor&amp;run=saved-run#first-monitoring"`)
    expect(html).not.toContain('step=monitor&amp;week=2026-10-05')
  })

  it('does not offer a new monitoring action for an empty filtered or legacy list', () => {
    const filtered = renderToString(<ObservationWorkspace {...propsFor('en', noAnswers)} initialFilters={{ result: 'success' }} />)
    expect(filtered).not.toContain(copyFor('en').smeMonitoringStatus)
    const legacy = renderToString(<ObservationWorkspace {...propsFor('en', noAnswers)} smeCopilot={false} />)
    expect(legacy).not.toContain(copyFor('en').smeMonitoringStatus)
  })

  it('does not count unknown question activity as active, and marks truncated counts', () => {
    const copy = copyFor('en')
    const initial = { ...withAnswers, questionsTruncated: true, questions: withAnswers.questions.map(q => ({ ...q, isActive: null })) }
    const html = renderToString(<ObservationWorkspace {...propsFor('en', initial)} />)
    const stats = html.split(`aria-label="${copy.smeStatsLabel}"`)[1].split('</section>')[0]
    expect(stats).toContain('>0+</p>')
    expect(html).toContain(copy.smeActivityUnknown)
    expect(html).toContain(copy.questionsTruncated)
  })

  it.each(['success', 'incomplete'] as const)('uses the %s count rather than the unfiltered record total', result => {
    const initial = { ...withAnswers, counts: { recordedRows: 9, successfulRows: 6, incompleteRows: 3 } }
    const copy = copyFor('en')
    const html = renderToString(<ObservationWorkspace {...propsFor('en', initial)} initialFilters={{ result }} />)
    const stats = html.split(`aria-label="${copy.smeStatsLabel}"`)[1].split('</section>')[0]
    expect(stats).toContain(`>${result === 'success' ? 6 : 3}</p>`)
    expect(stats).not.toContain('>9</p>')
  })

  it('does not promise a full answer when a record has no answer', () => {
    const html = renderToString(<ObservationWorkspace {...propsFor('en', withAnswers)} />)
    const missing = html.split('<article')[2].split('</article>')[0]
    expect(missing).toContain(copyFor('en').noAnswer)
    expect(missing).toContain(copyFor('en').smeViewRecord)
    expect(missing).not.toContain(copyFor('en').smeViewAnswer)
    expect(html).not.toContain(copyFor('en').workflowTitle)
    expect(html).not.toContain(copyFor('en').smeLatest)
  })

  it('keeps the flags-off evidence page as the only flat table', () => {
    const page = readFileSync('app/[lang]/dashboard/[clientId]/observations/page.tsx', 'utf8')
    expect(page).toContain('smeCopilot={isSmeCopilotUiEnabled()}')
    const legacy = renderToString(<ObservationWorkspace clientId={clientId} initial={withAnswers} copy={copyFor('zh-HK')} lang="zh-HK" />)
    expect(legacy).toContain(copyFor('zh-HK').title)
    expect(legacy).toContain(copyFor('zh-HK').historicalQuestion)
    expect(legacy).toContain(copyFor('zh-HK').retainedWeeks)
  })
})

describe('SME answer detail', () => {
  it.each(['en', 'zh-HK'])('puts the answer first and folds technical data away in %s', lang => {
    const copy = copyFor(lang)
    const observation = projectObservationDetail({
      id: '33333333-3333-4333-8333-333333333333',
      prompt_id: promptId,
      question: '香港邊度可以沖洗菲林相？',
      platform: 'ChatGPT',
      scan_week: '2026-11-09',
      created_at: '2026-11-10T10:00:00Z',
      raw_answer: 'FOTOMAX 有沖洗菲林相服務，價錢由 $48 起。',
      brand_mentioned: true,
      snapshot: { question: '香港邊度可以沖洗菲林相？', language: 'zh-HK', market: 'zh-HK', category: 'category_query' },
      brand_snapshot: { name: 'FOTOMAX', competitors: [] },
      requested_model: 'gpt-4.1',
      actual_model: 'gpt-4.1',
      collector: 'openrouter_api',
      collector_version: 'fixture.v1',
      provider_request_id: null,
      classifier_method: 'literal',
      classifier_version: 'fixture.v1',
      sentiment: 'neutral',
      matched_text: [],
      classification_status: 'classified',
    })
    const html = renderToString(<ObservationDetailContent observation={observation} copy={copy} smeCopilot />)
    const answer = html.indexOf(copy.smeKeyPoints)
    const full = html.indexOf(copy.rawAnswer)
    const technical = html.indexOf(copy.smeTechnical)
    expect(answer).toBeGreaterThan(-1)
    expect(full).toBeGreaterThan(answer)
    expect(technical).toBeGreaterThan(full)
    expect(html).not.toContain(copy.apiSample)
    expect(html).toContain(copy.smeEvidenceNote)
    // The technical block is still available, just folded into a disclosure.
    expect(html).toContain('<details')
    expect(html).toContain(copy.collector)
  })
})
