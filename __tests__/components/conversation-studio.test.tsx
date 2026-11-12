import { afterAll, expect, it } from 'vitest'
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { build } from 'vite'
import { ConversationStudio, StudioThreadHeader } from '@/components/dashboard/ConversationStudio'
import { StudioAttachedSource } from '@/components/dashboard/StudioAttachedSource'
import { StudioTurnTrace } from '@/components/dashboard/StudioTurnTrace'
import { renderWithIntl } from '@/__tests__/helpers/intl'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'
import { emptyStudioEvidence, savedStudioEvidence, savedStudioScan } from '@/__tests__/helpers/studio-evidence'
import { emptyStudioOpportunities, savedStudioOpportunities } from '@/__tests__/helpers/studio-opportunities'
import { composeSavedReply } from '@/lib/conversation-studio/reply'
import { STUDIO_TEMPLATES } from '@/lib/conversation-studio/types'
import { StudioEvidenceRows } from '@/components/dashboard/StudioEvidenceInspector'
import { StudioGscSnapshotView } from '@/components/dashboard/StudioGscSnapshot'
import { StudioDfsSnapshotView } from '@/components/dashboard/StudioDfsSnapshot'
import { StudioFirecrawlSnapshotView } from '@/components/dashboard/StudioFirecrawlSnapshot'
import { StudioSaveToDocs, saveStateFor, type SaveState } from '@/components/dashboard/StudioSaveToDocs'
import { StudioConnections } from '@/components/dashboard/StudioSecondaryViews'
import { StudioReplyView, StudioSavedEvidence } from '@/components/dashboard/StudioReply'
import { StudioLiveReplyView, StudioLiveEvidence } from '@/components/dashboard/StudioLiveReply'

it.each(['en', 'zh-HK'])('renders saved-evidence scope with templates, composer and temporary threads in %s', lang => {
  const copy = (lang === 'en' ? en : zh).conversationStudio
  const html = renderWithIntl(<ConversationStudio brandName="Example Brand" evidence={emptyStudioEvidence} />, lang)
  expect(html).toContain(copy.title)
  expect(html).toContain('Example Brand')
  expect(html).toContain(copy.threadsEmpty)
  expect(html).toContain(copy.privacyBody)
  expect(html).toContain(copy.savedNotice)
  expect(html).toContain(copy.featureShellNote)
  expect(html).toContain('<textarea')
  for (const key of STUDIO_TEMPLATES) expect(html).toContain(copy.templates[key].label)
  expect(html).not.toContain('<form action=')
})
it.each(['en', 'zh-HK'])('starts on home with six tasks, five filters and no conversation log in %s', lang => {
  const html = renderWithIntl(<ConversationStudio brandName="Example Brand" evidence={emptyStudioEvidence} />, lang)
  expect(html).not.toContain('role="log"')
  expect(html.match(/class="as-template /g)).toHaveLength(6)
  expect(html.match(/aria-pressed="(?:true|false)"/g)).toHaveLength(5)
  expect(html).toContain('disabled=""') // Choose documents disabled without clientId (no brand context)
  expect(html).not.toMatch(/Harbour Home|Harbour Tea|WI-DEMO/)
})
it.each(['en', 'zh-HK'])('renders the SME copilot landing with one-tap skills, one execution preview and no filters in %s', lang => {
  const copy = (lang === 'en' ? en : zh).conversationStudio
  const html = renderWithIntl(<ConversationStudio brandName="Example Brand" evidence={emptyStudioEvidence} smeCopilot />, lang)
  expect(html).toContain(copy.copilotTitle)
  expect(html).toContain(copy.copilotDescription.replace(/'/g, '&#x27;'))
  expect(html).toContain(copy.oneTapHint)
  // One preview line states what Send will read; the legacy scattered cap notes are gone.
  expect(html).toContain(copy.execution.preview.replace('{reads}', copy.execution.readsNothing).replace('{live}', '0'))
  expect(html).not.toContain(copy.featureShellNote)
  // The five filter chips do not exist on the copilot landing.
  expect(html).not.toContain('aria-pressed')
  expect(html.match(/class="as-filter"/g)).toBeNull()
  // Four outcomes stay up front; the other two skills live behind one disclosure.
  const more = html.indexOf(copy.moreSkills)
  expect(html.match(/class="as-template /g)).toHaveLength(6)
  expect(html.indexOf(copy.templates.pulse.label)).toBeLessThan(more)
  expect(html.indexOf(copy.templates.improve.label)).toBeLessThan(more)
  expect(html.indexOf(copy.templates.brief.label)).toBeGreaterThan(more)
  expect(html).toContain(copy.savedNotice)
})
it('keeps secondary Studio destinations reachable from the copilot landing without a rail', () => {
  const copy = en.conversationStudio
  const html = renderWithIntl(<ConversationStudio brandName="Example Brand" clientId="11111111-1111-4111-8111-111111111111" evidence={emptyStudioEvidence} smeCopilot />)
  expect(html).toContain(copy.chatMoreTitle)
  for (const path of ['threads', 'weekly', 'documents', 'connections', 'tools']) {
    expect(html).toContain(`/studio/${path}`)
  }
})
it.each(['en', 'zh-HK'])('keeps the legacy task-prefill landing when the SME flag is off in %s', lang => {
  const html = renderWithIntl(<ConversationStudio brandName="Example Brand" evidence={emptyStudioEvidence} />, lang)
  expect(html.match(/class="as-filter"/g)).toHaveLength(5)
  expect(html.match(/aria-pressed="(?:true|false)"/g)).toHaveLength(5)
})
it.each(['en', 'zh-HK'])('keeps Choose documents enabled when attach candidates are unavailable in %s', lang => {
  const copy = (lang === 'en' ? en : zh).conversationStudio
  const html = renderWithIntl(
    <ConversationStudio brandName="Example Brand" clientId="11111111-1111-4111-8111-111111111111" evidence={emptyStudioEvidence} attachCandidates={null} />,
    lang,
  )
  // Trigger stays clickable so the picker can disclose attach.unavailable honesty.
  expect(html).toContain(copy.chooseDocuments)
  const attachBtn = html.match(/<button type="button"[^>]*aria-controls="studio-attach-picker"[^>]*>/)
  expect(attachBtn?.[0]).toBeTruthy()
  expect(attachBtn?.[0]).not.toMatch(/\sdisabled(=|\s|>)/)
})
it.each(['bound', 'unbound', 'reconnect', 'rebind', 'unavailable'] as const)('renders the supplied GSC %s status without pretending a query ran', sourceStatus => {
  for (const lang of ['en', 'zh-HK']) {
    const copy = (lang === 'en' ? en : zh).conversationStudio
    const html = renderWithIntl(<ConversationStudio brandName="Example Brand" evidence={emptyStudioEvidence} sourceStatus={sourceStatus} />, lang)
    expect(html).toContain(copy.sources[sourceStatus])
    expect(html).toContain(copy.sources.notQueried)
  }
})
it.each(['en', 'zh-HK'])('renders insufficient and evidenced replies with honest coverage and real sources in %s', lang => {
  const copy = (lang === 'en' ? en : zh).conversationStudio.evidence
  const empty = renderWithIntl(<StudioReplyView id="empty" evidence={emptyStudioEvidence} reply={composeSavedReply('question', null, emptyStudioEvidence)} />, lang)
  expect(empty).toContain(copy.insufficient)
  const emptyPanel = renderWithIntl(<StudioSavedEvidence id="empty" evidence={emptyStudioEvidence} reply={composeSavedReply('question', null, emptyStudioEvidence)} />, lang)
  expect(emptyPanel).toContain(copy.noSources)
  expect(emptyPanel).toContain(copy.status.missing)
  expect(emptyPanel).toContain(copy.status.unsupported)
  const answer = renderWithIntl(<StudioReplyView id="saved" evidence={savedStudioEvidence} reply={composeSavedReply('pulse', 'pulse', savedStudioEvidence)} />, lang)
  const provenance = renderWithIntl(<StudioSavedEvidence id="saved" evidence={savedStudioEvidence} reply={composeSavedReply('pulse', 'pulse', savedStudioEvidence)} />, lang)
  expect(answer).not.toContain(savedStudioEvidence.observations[0].id)
  expect(answer).not.toContain(copy.coverageMeaning)
  const html = answer + provenance
  expect(provenance).toContain(copy.coverageMeaning)
  expect(html).toContain(copy.savedSummary)
  expect(html).toContain(copy.historicalQuote)
  expect(html).toContain(copy.searchUnknown)
  expect(html).toContain('https://example.com/bread')
  expect(html).toContain(savedStudioEvidence.observations[0].id)
  expect(html).toContain('2026-10-27T03:00:00Z')
  expect(html).toContain('<h3>Which bakery offers sourdough?</h3>')
  expect(html).toContain(copy.open)
  const research = html.match(/<details class="as-research">(.*?)<\/details>/s)![1]
  expect(research).toContain(copy.stepsTitle)
  expect(research.match(/<li>/g)).toHaveLength(3)
  expect(research).not.toMatch(/DataForSEO|Firecrawl|GSC/)
  const emptyResearch = empty.match(/<details class="as-research">(.*?)<\/details>/s)![1]
  expect(emptyResearch).toContain(copy.noSteps)
  expect(emptyResearch).not.toContain('<li>')
  expect(html).not.toContain('Live answers with evidence are coming in Stage B')
  const scanData = { ...emptyStudioEvidence, scan: savedStudioScan }
  const scanHtml = renderWithIntl(<StudioReplyView id="scan" evidence={scanData} reply={composeSavedReply('brief', 'brief', scanData)} />, lang)
  expect(scanHtml).toContain('owned-scan-evidence')
  const scanProvenance = renderWithIntl(<StudioSavedEvidence id="scan" evidence={scanData} reply={composeSavedReply('brief', 'brief', scanData)} />, lang)
  expect(scanProvenance).toContain(savedStudioScan!.id)
  expect(scanHtml).toContain('c1_robots')
  expect(scanHtml.match(/<details class="as-research">(.*?)<\/details>/s)![1]).not.toContain('2026-10-26')
})

it.each(['en', 'zh-HK'])('renders thread scope and brief context without invented dates or documents in %s', lang => {
  const copy = (lang === 'en' ? en : zh).conversationStudio
  const thread = { title: 'Source goal', goal: 'Original question', kind: 'research' as const, week: '2026-10-26', saveState: 'persisted' as const, visibility: 'private' as const, branchOf: null }
  const html = renderWithIntl(<StudioThreadHeader thread={thread} onHome={() => {}} />, lang)
  expect(html).toContain(copy.discussionEyebrow)
  expect(html).toContain(copy.privateLabel)
  expect(html).not.toContain(copy.temporaryLabel)
  expect(html).toContain('<h1 class="[overflow-wrap:anywhere]">Source goal</h1>')
  expect(html).toContain(copy.localeBadge)
  expect(html).toContain(copy.savedWeek.replace('{week}', thread.week))
  expect(html).not.toMatch(/28 days|產品資料|Selected documents/)
  const brief = renderWithIntl(<StudioThreadHeader thread={{ ...thread, kind: 'brief', week: null, sourceTitle: 'Source discussion' }} onHome={() => {}} />, lang)
  const unsaved = renderWithIntl(<StudioThreadHeader thread={{ ...thread, saveState: 'failed' }} onHome={() => {}} />, lang)
  expect(unsaved).toContain(copy.temporaryLabel)
  expect(unsaved).not.toContain(copy.privateLabel)
  expect(brief).toContain(copy.briefEyebrow)
  expect(brief).toContain('Original question')
  expect(brief).toContain('Source discussion')
  expect(brief).toContain(copy.briefTemporary)
  expect(brief).not.toContain('2026-10-26')
})

it.each(['en', 'zh-HK'])('shows branch lineage with its origin link, or without a link when the origin is not visible in %s', lang => {
  const copy = (lang === 'en' ? en : zh).conversationStudio
  const thread = { title: 'Branch of Source goal', goal: 'Original question', kind: 'research' as const, week: '2026-10-26', saveState: 'persisted' as const, visibility: 'private' as const, branchOf: { threadId: 'thread-origin', turnId: 'turn-origin' } }
  const linked = renderWithIntl(<StudioThreadHeader thread={thread} onHome={() => {}} originTitle="Source goal" onOpenOrigin={() => {}} />, lang)
  expect(linked).toContain(copy.branchedFrom.replace('{title}', 'Source goal'))
  const unlinked = renderWithIntl(<StudioThreadHeader thread={thread} onHome={() => {}} originTitle={null} />, lang)
  expect(unlinked).toContain(copy.branchedFromUnknown)
  const fresh = renderWithIntl(<StudioThreadHeader thread={{ ...thread, branchOf: null }} onHome={() => {}} originTitle="Source goal" onOpenOrigin={() => {}} />, lang)
  expect(fresh).not.toContain(copy.branchedFrom.replace('{title}', 'Source goal'))
  expect(fresh).not.toContain(copy.branchedFromUnknown)
})

it.each(['en', 'zh-HK'])('shows the server-composed receipts in the evidence trace in %s', lang => {
  const copy = (lang === 'en' ? en : zh).conversationStudio.receipts
  const receipts = [
    { kind: 'pulse-week' as const, id: '2026-10-26', records: 12, truncated: false, digest: 'a'.repeat(64) },
    { kind: 'pulse-observations' as const, id: null, records: 3, truncated: true, digest: 'b'.repeat(64) },
    { kind: 'compose' as const, id: null, records: 3, truncated: false, digest: 'cdef0123'.padEnd(64, '0') },
  ]
  const html = renderWithIntl(<StudioTurnTrace receipts={receipts} />, lang)
  expect(html).toContain(copy.title)
  expect(html).toContain(copy.pulseWeek.replace('{id}', '2026-10-26'))
  expect(html).toContain(copy.observations)
  expect(html).toContain(copy.count.replace('{count}', '3'))
  expect(html).toContain(copy.truncated)
  expect(html).toContain(copy.digest.replace('{digest}', 'cdef0123'))
  // A turn saved before B1 has no receipts and shows no receipt claim.
  expect(renderWithIntl(<StudioTurnTrace />, lang)).not.toContain(copy.title)
})

it.each(['en', 'zh-HK'])('shows the attached source version, or that the saved path did not read it, in %s', lang => {
  const copy = (lang === 'en' ? en : zh).conversationStudio.attach.attachedSource
  const documents = { truncated: false, items: [{ id: 'source-1', label: 'Brand FAQ', versionId: 'version-3', versionNumber: 3, approvedAt: '2026-11-01T00:00:00Z', importedAt: '2026-10-01T00:00:00Z' }] }
  const recorded = renderWithIntl(<StudioAttachedSource attached={{ label: 'Brand FAQ', versionNumber: 3 }} documents={documents} />, lang)
  expect(recorded).toContain(copy.title)
  expect(recorded).toContain(copy.savedNotRead)
  expect(recorded).toContain(copy.recordedVersion.replace('{version}', '3'))
  expect(recorded).not.toContain(copy.newerVersion.replace('{version}', '3'))

  const live = renderWithIntl(<StudioAttachedSource
    attached={{ label: 'Brand FAQ', versionNumber: 2 }}
    liveAttachment={{ sourceId: 'source-1', label: 'Brand FAQ', versionId: 'version-2', versionNumber: 2, contentHash: 'abcdef0123456789', entriesIncluded: 4, entriesTotal: 6, truncated: true, characters: 900 }}
    documents={documents} />, lang)
  expect(live).toContain(copy.liveRead.replace('{version}', '2'))
  expect(live).toContain(copy.entries.replace('{included}', '4').replace('{total}', '6'))
  expect(live).toContain(copy.truncated)
  expect(live).toContain(copy.newerVersion.replace('{version}', '3'))
  expect(live).toContain('abcdef01')

  expect(renderWithIntl(<StudioAttachedSource attached={null} documents={documents} />, lang)).not.toContain(copy.title)
})

it.each(['en', 'zh-HK'])('keeps result destinations in the supplied brand and omits them without brand context in %s', lang => {
  const copy = (lang === 'en' ? en : zh).conversationStudio
  const reply = composeSavedReply('pulse', 'pulse', savedStudioEvidence)
  for (const clientId of ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222']) {
    const html = renderWithIntl(<StudioReplyView clientId={clientId} id="saved" evidence={savedStudioEvidence} reply={reply} />, lang)
    for (const destination of ['opportunities', 'reports', 'studio/tools']) expect(html).toContain(`href="/${lang}/dashboard/${clientId}/${destination}"`)
    for (const label of [copy.destinations.opportunities, copy.destinations.reports, copy.viewTools]) expect(html).toContain(label)
    // Preserve the dashboard's hidden Monitor section and existing authority gates.
    expect(html).not.toMatch(/step=monitor|\/admin|\/dashboard\/settings/)
  }
  const unscoped = renderWithIntl(<StudioReplyView id="saved" evidence={savedStudioEvidence} reply={reply} />, lang)
  expect(unscoped).not.toContain('/dashboard/')
})

it.each(['en', 'zh-HK'])('renders real saved opportunity titles, evidence refs and the same-brand I5 link in %s', lang => {
  const copy = (lang === 'en' ? en : zh).conversationStudio
  const clientId = '11111111-1111-4111-8111-111111111111'
  const reply = composeSavedReply(copy.templates.opportunity.prompt, 'opportunity', emptyStudioEvidence, savedStudioOpportunities)
  const html = renderWithIntl(<StudioReplyView clientId={clientId} id="opportunity" evidence={emptyStudioEvidence} reply={reply} />, lang)
  expect(html).toContain(savedStudioOpportunities.suggestions[0].title)
  expect(html).toContain(savedStudioOpportunities.suggestions[1].title)
  expect(html).toContain('30000000-0000-4000-8000-000000000001')
  expect(html).toContain('40000000-0000-4000-8000-000000000001')
  expect(html).toContain('c11_faq')
  expect(html).toContain(copy.honesty.searchDemandPending)
  expect(html).toContain(`href="/${lang}/dashboard/${clientId}/opportunities"`)
  expect(html).toContain(copy.destinations.opportunities)
  expect(html).not.toMatch(/Harbour Home|WI-DEMO|rank #\d|volume \d/i)
})

it.each(['en', 'zh-HK'])('offers save-as-draft only for saveable opportunities with a brand in %s', lang => {
  const copy = (lang === 'en' ? en : zh).conversationStudio
  const clientId = '11111111-1111-4111-8111-111111111111'
  const reply = composeSavedReply(copy.templates.opportunity.prompt, 'opportunity', emptyStudioEvidence, savedStudioOpportunities)
  const count = (html: string) => html.split(copy.workItemDraftReview).length - 1
  const scoped = renderWithIntl(<StudioReplyView clientId={clientId} id="opportunity" evidence={emptyStudioEvidence} reply={reply} />, lang)
  expect(count(scoped)).toBe(2)
  expect(scoped).toContain(copy.workItemDraftReview)
  expect(scoped).not.toContain(copy.workItemDraftLimited)
  const unscoped = renderWithIntl(<StudioReplyView id="opportunity" evidence={emptyStudioEvidence} reply={reply} />, lang)
  expect(count(unscoped)).toBe(0)
  expect(unscoped).not.toContain(copy.workItemDraftReview)
  const limited = {
    ...savedStudioOpportunities,
    suggestions: savedStudioOpportunities.suggestions.map(suggestion => ({ ...suggestion, saveAvailability: 'limited-evidence' as const })),
  }
  const limitedHtml = renderWithIntl(<StudioReplyView clientId={clientId} id="opportunity" evidence={emptyStudioEvidence} reply={{ ...reply, opportunities: limited }} />, lang)
  expect(count(limitedHtml)).toBe(0)
  expect(limitedHtml).toContain(copy.workItemDraftLimited)
  const alreadySaved = {
    ...savedStudioOpportunities,
    suggestions: savedStudioOpportunities.suggestions.map((suggestion, index) => index === 0
      ? { ...suggestion, savedDraftId: '55555555-5555-4555-8555-555555555555', savedState: 'saved' as const }
      : suggestion),
  }
  const savedHtml = renderWithIntl(<StudioReplyView clientId={clientId} id="opportunity" evidence={emptyStudioEvidence} reply={{ ...reply, opportunities: alreadySaved }} />, lang)
  expect(count(savedHtml)).toBe(1)
  expect(savedHtml).toContain(copy.workItemDraftAlreadySaved)
  expect(savedHtml).toContain(copy.openWorkItemDraft)
  expect(savedHtml).toContain(`href="/${lang}/dashboard/${clientId}/work-items/55555555-5555-4555-8555-555555555555/versions"`)
})

it.each(['en', 'zh-HK'])('renders empty and pending opportunity reads without inventing rows in %s', lang => {
  const copy = (lang === 'en' ? en : zh).conversationStudio
  for (const [opportunities, text] of [
    [emptyStudioOpportunities, copy.templates.opportunity.empty],
    [undefined, copy.templates.opportunity.pending],
  ] as const) {
    const reply = composeSavedReply(copy.templates.opportunity.prompt, 'opportunity', emptyStudioEvidence, opportunities)
    const html = renderWithIntl(<StudioReplyView id="opportunity" evidence={emptyStudioEvidence} reply={reply} />, lang)
    expect(html).toContain(text)
    expect(html).not.toContain('<li class="as-result')
    expect(html).not.toMatch(/Harbour Home|WI-DEMO|30000000/)
  }
})

it.each(['en', 'zh-HK'])('renders live disabled/plan states and safe, unverified output in %s', lang => {
  const studioCopy = (lang === 'en' ? en : zh).conversationStudio
  const copy = studioCopy.live
  const ui = (cap: number, platforms = ['gemini-flash']) => renderWithIntl(<ConversationStudio brandName="Brand" clientId="brand-id" evidence={emptyStudioEvidence} live={{ cap, platforms }} />, lang)
  expect(ui(0)).toContain(copy.disabled)
  expect(ui(2)).toContain('gemini-flash')
  expect(ui(2)).not.toContain('gpt-4o')
  expect(ui(2, [])).toContain(copy.upgrade)
  expect(ui(2)).toContain(copy.temporaryCap)
  expect(ui(0)).not.toContain(studioCopy.featureShellNote)
  const reply = { quota: { cap: 10, remaining: 9, scope: 'brand' }, answers: [{
    platform: 'gemini-flash', coverage: 'present', answer: '<script>unsafe</script>', model: 'mock-model',
    startedAt: '2026-10-28T00:00:00Z', durationMs: 123, finishReason: 'length', grounding: 'none',
    searchEvidence: { requested: 'none', execution: 'unknown', basis: 'request-only' }, error: null,
    citations: [{ url: 'javascript:alert(1)', title: 'Unsafe' }, { url: 'https://source.example/', title: 'Source' }],
  }] } as const
  const result = { ...reply, answers: reply.answers.map(answer => ({ ...answer, citations: [...answer.citations] })) }
  const html = renderWithIntl(<><StudioLiveReplyView reply={result} /><StudioLiveEvidence reply={result} id="live" /></>, lang)
  expect(html).toContain(copy.unverified)
  expect(html).toContain(copy.unverifiedTitle)
  expect(html).toContain('as-live-result')
  expect(html).toContain(copy.searchUnknown)
  expect(html).toContain('mock-model')
  expect(html).toContain('length')
  expect(html).not.toContain('<script>')
  expect(html).not.toContain('javascript:')
  expect(html).toContain('href="https://source.example/"')
  const exhausted = renderWithIntl(<StudioLiveReplyView error="STUDIO_QUOTA_EXCEEDED" />, lang)
  expect(exhausted).toContain(copy.exhausted)
  expect(exhausted).toContain('as-live-exhausted')
})

it.each(['en', 'zh-HK'])('renders inspector rows from loaded metadata or explicit gaps in %s', lang => {
  const copy = (lang === 'en' ? en : zh).conversationStudio
  const unknown = renderWithIntl(<StudioEvidenceRows reads={{ documents: null, searchConsole: null }} sourceStatus="unavailable" />, lang)
  for (const key of ['brandDocuments', 'searchConsole', 'dataForSeo', 'firecrawl'] as const) expect(unknown).toContain(copy.evidence[key])
  expect(unknown).toContain(copy.honesty.pending)
  expect(unknown).toContain(copy.evidence.notQueried)
  expect(unknown.match(new RegExp(copy.connections.disconnected, 'g'))).toHaveLength(2)
  expect(unknown).not.toMatch(/<button|<a |Harbour|WI-DEMO/)
  const synced = renderWithIntl(<StudioEvidenceRows reads={{ documents: { items: [], truncated: false }, searchConsole: { kind: 'synced', dataThrough: '2026-10-26' } }} sourceStatus="bound" />, lang)
  expect(synced).toContain(copy.evidence.unknown)
  expect(synced).toContain(copy.evidence.sync.synced)
  expect(synced).toContain('2026-10-26')
  expect(synced).toContain(copy.evidence.notQueried)
  expect(synced).not.toMatch(/clicks|impressions|rankings|<button/)
})

it.each(['en', 'zh-HK'])('renders the Hong Kong Pacific snapshot for this turn and drops the not-queried badge in %s', lang => {
  const copy = (lang === 'en' ? en : zh).conversationStudio
  const gsc = {
    snapshot: {
      status: 'ok' as const, country: 'hkg' as const, completeness: 'complete' as const,
      window: { startDate: '2026-10-03', endDate: '2026-10-30', timeZone: 'America/Los_Angeles' as const, lagDays: 3 },
      totals: { clicks: 20, impressions: 500, ctr: 0.04, position: 4.9 },
      topQueries: [{ query: 'buy widgets', clicks: 5, impressions: 100 }],
    },
  }
  const snapshot = renderWithIntl(<StudioGscSnapshotView gsc={gsc} />, lang)
  expect(snapshot).toContain(copy.gsc.title)
  expect(snapshot).toContain(copy.gsc.country)
  expect(snapshot).toContain(copy.gsc.timeZone)
  expect(snapshot).toContain('2026-10-03')
  expect(snapshot).toContain('2026-10-30')
  expect(snapshot).toContain(copy.gsc.status.ok)
  expect(snapshot).toContain(copy.gsc.clicks + ': 20')
  expect(snapshot).toContain(copy.gsc.impressions + ': 500')
  expect(snapshot).toContain('4.00%')
  expect(snapshot).toContain('buy widgets')
  expect(snapshot).not.toContain(copy.sources.notQueried)

  const reply = composeSavedReply('question', null, emptyStudioEvidence)
  const withStep = renderWithIntl(<StudioReplyView id="gsc" evidence={emptyStudioEvidence} reply={reply} gsc={gsc} />, lang)
  expect(withStep).toContain(copy.gsc.researchStep.replace('{startDate}', '2026-10-03').replace('{endDate}', '2026-10-30'))

  const rows = renderWithIntl(<StudioEvidenceRows reads={{ documents: null, searchConsole: null }} sourceStatus="bound" gsc={gsc} />, lang)
  expect(rows).toContain(copy.gsc.title)
  expect(rows).not.toContain(copy.evidence.notQueried)
})

it.each(['en', 'zh-HK'])('shows honest empty, quota and unbound snapshot states without invented metrics in %s', lang => {
  const copy = (lang === 'en' ? en : zh).conversationStudio
  const render = (status: string, extra: Record<string, unknown> = {}) => renderWithIntl(<StudioGscSnapshotView gsc={{ snapshot: { status, country: 'hkg', completeness: 'unknown', ...extra } as never }} />, lang)
  expect(render('empty', { window: { startDate: '2026-10-03', endDate: '2026-10-30', timeZone: 'America/Los_Angeles', lagDays: 3 } })).toContain(copy.gsc.empty)
  expect(render('quota')).toContain(copy.gsc.status.quota)
  expect(render('unbound')).toContain(copy.gsc.status.unbound)
  expect(render('unbound')).toContain(copy.gsc.notRun)
  expect(render('quota')).not.toContain(copy.gsc.notRun)
  expect(render('quota')).not.toMatch(/Clicks:|Impressions:/)
  expect(renderWithIntl(<StudioGscSnapshotView gsc={{ error: 'STUDIO_UNAVAILABLE' }} />, lang)).toContain(copy.gsc.failed)
})

it.each(['en', 'zh-HK'])('renders the DataForSEO SERP snapshot, cap and 待核實 chrome in %s', lang => {
  const copy = (lang === 'en' ? en : zh).conversationStudio
  const dfs = {
    snapshot: {
      status: 'ok' as const, locationPending: true as const, keyword: 'buy widgets',
      locationCode: 2344, languageCode: 'zh-TW',
      week: { weekStart: '2026-11-02', timeZone: 'Asia/Hong_Kong' as const, remaining: 19, cap: 20 },
      items: [{ rank: 1, title: 'Example result', url: 'https://example.com/a', domain: 'example.com' }],
    },
  }
  const snapshot = renderWithIntl(<StudioDfsSnapshotView dfs={dfs} />, lang)
  expect(snapshot).toContain(copy.dfs.title)
  expect(snapshot).toContain(copy.dfs.status.ok)
  expect(snapshot).toContain(copy.dfs.weeklyCap.replace('{remaining}', '19').replace('{cap}', '20'))
  expect(snapshot).toContain(copy.dfs.market)
  // Vendor location/language codes never reach operators (post–Stage 6 rename).
  expect(snapshot).not.toContain('2344')
  expect(snapshot).not.toContain('zh-TW')
  expect(snapshot).not.toMatch(/DataForSEO|Firecrawl/)
  expect(snapshot).toContain(copy.honesty.pending)
  expect(snapshot).toContain('buy widgets')
  expect(snapshot).toContain('Example result')
  expect(snapshot).not.toMatch(/\$\d/)

  const capped = renderWithIntl(<StudioDfsSnapshotView dfs={{ snapshot: { ...dfs.snapshot, status: 'capped', week: { ...dfs.snapshot.week, remaining: 0 } } }} />, lang)
  expect(capped).toContain(copy.dfs.capped)
  expect(capped).toContain(copy.dfs.status.capped)
  const disconnected = renderWithIntl(<StudioDfsSnapshotView dfs={{ snapshot: { status: 'disconnected', locationPending: true } }} />, lang)
  expect(disconnected).toContain(copy.dfs.status.disconnected)

  const reply = composeSavedReply('question', null, emptyStudioEvidence)
  const withStep = renderWithIntl(<StudioReplyView id="dfs" evidence={emptyStudioEvidence} reply={reply} dfs={dfs} />, lang)
  expect(withStep).toContain(copy.dfs.researchStep.replace('{keyword}', 'buy widgets'))
  const failed = renderWithIntl(<StudioReplyView id="dfs-failed" evidence={emptyStudioEvidence} reply={reply} dfs={{ snapshot: { ...dfs.snapshot, status: 'auth' } }} />, lang)
  expect(failed).not.toContain(copy.dfs.researchStep.replace('{keyword}', 'buy widgets'))
  const rows = renderWithIntl(<StudioEvidenceRows reads={{ documents: null, searchConsole: null }} sourceStatus="bound" dfs={dfs} />, lang)
  expect(rows).toContain(copy.dfs.title)
  expect(rows).toContain(copy.dfs.status.ok)
})

it.each(['en', 'zh-HK'])('keeps Firecrawl disconnected while the DataForSEO switch is explicit in %s', lang => {
  const copy = (lang === 'en' ? en : zh).conversationStudio
  const html = renderWithIntl(<StudioConnections clientId="11111111-1111-4111-8111-111111111111" connection={{
    sourceStatus: 'bound', state: { kind: 'synced', dataThrough: '2026-10-26' },
    dfs: { enabled: false, credentialsConfigured: false, locationCode: 2344, languageCode: 'zh-TW' },
  }} />, lang)
  expect(html).toContain(copy.connections.dfsDisabled)
  expect(html).toContain(copy.connections.dfsSerpPending)
  expect(html).toContain(copy.connections.dfsSettingsNote)
  expect(html).not.toMatch(/DataForSEO|Firecrawl|Preview/)
  expect(html).toContain(copy.connections.dfsEnable)
  expect(html).toContain(copy.honesty.mentionsCoverage)
  expect(html).toContain(copy.evidence.firecrawl)
  expect(html).toContain(copy.connections.disconnected)
})

it.each(['en', 'zh-HK'])('renders the Firecrawl public-page snapshot and honest soft-fails in %s', lang => {
  const copy = (lang === 'en' ? en : zh).conversationStudio
  const firecrawl = {
    snapshot: { status: 'ok' as const, url: 'https://example.com/a', title: 'Example page', excerpt: 'Main content excerpt', contentType: 'text/html' },
  }
  const html = renderWithIntl(<StudioFirecrawlSnapshotView firecrawl={firecrawl} />, lang)
  expect(html).toContain(copy.firecrawl.title)
  expect(html).toContain(copy.firecrawl.status.ok)
  expect(html).toContain('href="https://example.com/a"')
  expect(html).toContain('Example page')
  expect(html).toContain('Main content excerpt')
  expect(html).not.toMatch(/\$\d|credit/i)

  for (const [status, note] of [['invalid', 'urlNotPublic'], ['invalid', 'urlTooLong'], ['invalid', 'urlUnresolved'], ['empty', 'pageError'], ['empty', 'empty']] as const) {
    const soft = renderWithIntl(<StudioFirecrawlSnapshotView firecrawl={{ snapshot: { status, messageKey: `firecrawl.${note}` } }} />, lang)
    expect(soft).toContain(copy.firecrawl.status[status])
    expect(soft).toContain(copy.firecrawl.notes[note])
  }
  for (const status of ['disabled', 'disconnected', 'auth', 'payment', 'rate_limit', 'unavailable', 'misconfigured'] as const) {
    expect(renderWithIntl(<StudioFirecrawlSnapshotView firecrawl={{ snapshot: { status } }} />, lang)).toContain(copy.firecrawl.status[status])
  }
  expect(renderWithIntl(<StudioFirecrawlSnapshotView firecrawl={{ pending: true }} />, lang)).toContain(copy.firecrawl.pending)
  expect(renderWithIntl(<StudioFirecrawlSnapshotView firecrawl={{ error: 'STUDIO_UNAVAILABLE' }} />, lang)).toContain(copy.firecrawl.failed)
  const unsafe = renderWithIntl(<StudioFirecrawlSnapshotView firecrawl={{ snapshot: { status: 'ok', url: 'javascript:alert(1)', excerpt: 'x' } }} />, lang)
  expect(unsafe).not.toContain('javascript:')

  const reply = composeSavedReply('question', null, emptyStudioEvidence)
  const step = copy.firecrawl.researchStep.replace('{url}', 'https://example.com/a')
  expect(renderWithIntl(<StudioReplyView id="fc" evidence={emptyStudioEvidence} reply={reply} firecrawl={firecrawl} />, lang)).toContain(step)
  for (const status of ['invalid', 'disabled', 'disconnected', 'auth'] as const) {
    const failed = renderWithIntl(<StudioReplyView id="fc-failed" evidence={emptyStudioEvidence} reply={reply} firecrawl={{ snapshot: { status, url: 'https://example.com/a' } }} />, lang)
    expect(failed).not.toContain(step)
  }
  const rows = renderWithIntl(<StudioEvidenceRows reads={{ documents: null, searchConsole: null }} sourceStatus="bound" firecrawl={firecrawl} />, lang)
  expect(rows).toContain(copy.firecrawl.title)
  expect(rows).toContain('Main content excerpt')
})

it.each(['en', 'zh-HK'])('shows the default-OFF Firecrawl brand switch in %s', lang => {
  const copy = (lang === 'en' ? en : zh).conversationStudio
  const html = renderWithIntl(<StudioConnections clientId="11111111-1111-4111-8111-111111111111" connection={{
    sourceStatus: 'bound', state: { kind: 'synced', dataThrough: '2026-10-26' },
    firecrawl: { enabled: false, keyConfigured: false },
  }} />, lang)
  expect(html).toContain(copy.connections.firecrawlDisabled)
  expect(html).toContain(copy.connections.disconnected)
  expect(html).not.toMatch(/DataForSEO|Firecrawl|Preview/)
  expect(html).toContain(copy.connections.firecrawlSettingsNote)
  expect(html).toContain(copy.connections.firecrawlEnable)
  expect(html).not.toContain(copy.connections.firecrawlScope)
  expect(html).not.toMatch(/\$\d/)
  const on = renderWithIntl(<StudioConnections clientId="11111111-1111-4111-8111-111111111111" connection={{
    sourceStatus: 'bound', state: null, firecrawl: { enabled: true, keyConfigured: true },
  }} />, lang)
  expect(on).toContain(copy.connections.firecrawlEnabled)
  expect(on).toContain(copy.connections.firecrawlDisable)
  // Only the DataForSEO fallback card (no settings passed) still says 未連接.
  const disconnectedCount = (markup: string) => markup.split(copy.connections.disconnected).length - 1
  expect(disconnectedCount(on)).toBe(disconnectedCount(html) - 1)
})

it.each(['en', 'zh-HK'])('shows the member’s own Google Drive card for the act/edit path in %s', lang => {
  const copy = (lang === 'en' ? en : zh).conversationStudio
  const base = { sourceStatus: 'bound' as const, state: null }
  const clientId = '11111111-1111-4111-8111-111111111111'
  const off = renderWithIntl(<StudioConnections clientId={clientId} connection={{ ...base, drive: { status: 'disconnected', googleEmail: null } }} />, lang)
  expect(off).toContain(copy.connections.driveTitle)
  expect(off).toContain(copy.connections.driveScope)
  expect(off).toContain(copy.connections.driveConnect)
  const returnPath = encodeURIComponent(`/${lang}/dashboard/${clientId}/studio/connections`)
  expect(off).toContain(`href="/api/integrations/google/drive/start?return=${returnPath}"`)
  expect(off).not.toContain(copy.connections.driveDisconnect)

  const on = renderWithIntl(<StudioConnections clientId={clientId} connection={{ ...base, drive: { status: 'active', googleEmail: 'member@example.com' } }} />, lang)
  expect(on).toContain(copy.connections.driveConnectedAs.replace('{email}', 'member@example.com'))
  expect(on).toContain(copy.connections.driveDisconnect)
  expect(on).not.toContain('/api/integrations/google/drive/start')

  const stale = renderWithIntl(<StudioConnections clientId={clientId} connection={{ ...base, drive: { status: 'needs_reconnect', googleEmail: 'member@example.com' } }} />, lang)
  expect(stale).toContain(copy.connections.driveReconnectNeeded)
  expect(stale).toContain(copy.connections.driveReconnect)

  const drive = { status: 'disconnected' as const, googleEmail: null }
  expect(renderWithIntl(<StudioConnections clientId={clientId} connection={{ ...base, drive }} driveNotice="connected" />, lang)).toContain(copy.connections.driveNoticeConnected)
  expect(renderWithIntl(<StudioConnections clientId={clientId} connection={{ ...base, drive }} driveNotice="failed" />, lang)).toContain(copy.connections.driveNoticeFailed)
  expect(renderWithIntl(<StudioConnections clientId={clientId} connection={{ ...base, drive }} driveNotice="scope" />, lang)).toContain(copy.connections.driveNoticeScope)

  // An unknown read (no drive field) shows no card rather than a false 未連接.
  const unknown = renderWithIntl(<StudioConnections clientId={clientId} connection={base} />, lang)
  expect(unknown).not.toContain(copy.connections.driveTitle)
  expect(off + on).not.toMatch(/DataForSEO|Firecrawl|\$\d/)
})

it('maps every export answer to an honest Save to Google Docs state', () => {
  const link = 'https://docs.google.com/document/d/f/edit'
  expect(saveStateFor(201, { link })).toEqual({ kind: 'saved', link })
  expect(saveStateFor(201, { link: 'https://evil.example/doc' })).toEqual({ kind: 'saved', link: null })
  expect(saveStateFor(202, null)).toEqual({ kind: 'unknown' })
  expect(saveStateFor(409, { error: 'DRIVE_NOT_CONNECTED' })).toEqual({ kind: 'notConnected' })
  expect(saveStateFor(409, { error: 'DRIVE_RECONNECT' })).toEqual({ kind: 'reconnect' })
  expect(saveStateFor(429, { error: 'DRIVE_QUOTA' })).toEqual({ kind: 'quota' })
  expect(saveStateFor(500, { error: 'DRIVE_LEDGER_FAILED', link })).toEqual({ kind: 'ledgerFailed', link })
  expect(saveStateFor(502, { error: 'DRIVE_UNAVAILABLE' })).toEqual({ kind: 'failed' })
  expect(saveStateFor(503, null)).toEqual({ kind: 'failed' })
})

it.each(['en', 'zh-HK'])('renders Save to Google Docs states in %s', lang => {
  const copy = (lang === 'en' ? en : zh).conversationStudio.drive
  const clientId = '11111111-1111-4111-8111-111111111111'
  const view = (initial: SaveState) => renderWithIntl(<StudioSaveToDocs clientId={clientId} threadId="t" position={0} initial={initial} />, lang)
  expect(view({ kind: 'idle' })).toContain(copy.save)
  expect(view({ kind: 'saving' })).toContain(copy.saving)
  const saved = view({ kind: 'saved', link: 'https://docs.google.com/document/d/f/edit' })
  expect(saved).toContain(copy.saved)
  expect(saved).toContain('href="https://docs.google.com/document/d/f/edit"')
  expect(saved).not.toContain(copy.save + '</button>')
  const unknown = view({ kind: 'unknown' })
  expect(unknown).toContain(copy.unknown)
  expect(unknown).toContain('href="https://drive.google.com/drive/my-drive"')
  const notConnected = view({ kind: 'notConnected' })
  expect(notConnected).toContain(copy.notConnected)
  expect(notConnected).toContain(`href="/${lang}/dashboard/${clientId}/studio/connections"`)
  expect(view({ kind: 'reconnect' })).toContain(copy.reconnect)
  expect(view({ kind: 'quota' })).toContain(copy.quota)
  expect(view({ kind: 'failed' })).toContain(copy.failed)
  expect(view({ kind: 'ledgerFailed', link: null })).toContain(copy.ledgerFailed)
})

// Real interactive production component in an offline browser fixture. This
// never bypasses dashboard authentication or constructs SQL/Auth clients.
afterAll(async () => {
  const directory = process.env.STUDIO_HTML_DIR
  if (!directory) return
  mkdirSync(directory, { recursive: true })
  const entry = join(resolve(directory), 'entry.tsx')
  // Standalone fixture has no Next router. Internal Studio links are exercised
  // by studio-shell-fixture with its navigation transport.
  const link = join(resolve(directory), 'standalone-link.tsx')
  writeFileSync(link, `import React from 'react';export default function Link({prefetch,...props}){return <a {...props}/>}`)
  writeFileSync(entry, `import React from 'react';
import {createRoot} from 'react-dom/client';
import {NextIntlClientProvider} from 'next-intl';
import {ConversationStudio} from '@/components/dashboard/ConversationStudio';
import {emptyStudioEvidence,savedStudioEvidence,savedStudioScan} from '@/__tests__/helpers/studio-evidence';
import {emptyStudioOpportunities,pendingStudioOpportunities,savedStudioOpportunities} from '@/__tests__/helpers/studio-opportunities';
import en from '@/messages/en.json'; import zh from '@/messages/zh-HK.json';

// Offline thread transport for the standalone fixture. It is deliberately
// page-scoped so reload resets this fixture; production reload persistence is
// covered by studio-shell-fixture, so specs must not assert reload emptiness.
const fixtureThreads=new Map();
const fixtureJson=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
const fixtureFetch=window.fetch.bind(window);
window.fetch=async(input,init={})=>{const url=typeof input==='string'?input:input.url;if(url.includes('/studio/dataforseo/settings'))return studioJson({enabled:true});if(url.includes('/studio/dataforseo'))return studioJson({snapshot:{status:'ok',locationPending:true,week:{weekStart:'2026-11-02',timeZone:'Asia/Hong_Kong',remaining:19,cap:20},locationCode:2344,languageCode:'zh-TW',keyword:'fixture',items:[]}});if(url.includes('/studio/search-console'))return fixtureJson({snapshot:{status:'ok',country:'hkg',completeness:'complete',window:{startDate:'2026-10-03',endDate:'2026-10-30',timeZone:'America/Los_Angeles',lagDays:3},totals:{clicks:20,impressions:500,ctr:0.04,position:4.9},topQueries:[{query:'buy widgets',clicks:5,impressions:100}]}});const match=url.match(new RegExp('/api/dashboard/clients/([^/]+)/studio/threads(?:/([^/]+))?(?:/turns)?$'));if(!match)return fixtureFetch(input,init);const method=(init.method||'GET').toUpperCase();if(!match[2]){if(method==='GET')return fixtureJson({threads:[],truncated:false});const body=JSON.parse(init.body);const now=new Date().toISOString();const created={id:crypto.randomUUID(),title:body.title,goal:body.goal,week:body.week==null?null:body.week,kind:body.kind,sourceTitle:body.sourceTitle==null?null:body.sourceTitle,turns:[],createdAt:now,updatedAt:now};fixtureThreads.set(created.id,created);return fixtureJson({thread:{...created,turnCount:0}},201)}const found=fixtureThreads.get(match[2]);if(!found)return fixtureJson({error:'NOT_FOUND'},404);if(method==='GET')return fixtureJson({thread:{...found,turnCount:found.turns.length},turns:found.turns});if(method==='POST'){const body=JSON.parse(init.body);const turn={id:crypto.randomUUID(),position:found.turns.length,prompt:body.prompt,task:body.task==null?null:body.task,reply:body.reply,attached:body.attached==null?null:body.attached,live:null,createdAt:new Date().toISOString()};found.turns.push(turn);return fixtureJson({turn},201)}if(method==='PATCH'){const body=JSON.parse(init.body);const turn=found.turns.find(item=>item.position===body.position);if(!turn)return fixtureJson({error:'NOT_FOUND'},404);turn.live=body.live;return fixtureJson({turn})}return fixtureJson({error:'INVALID_STUDIO_THREAD'},400)};
const locale=document.documentElement.lang;
const evidence=location.search.includes('empty=1')?emptyStudioEvidence:location.search.includes('scan=1')?{...savedStudioEvidence,scan:savedStudioScan}:savedStudioEvidence;
const params=new URLSearchParams(location.search);
const opportunities=params.get('opps')==='empty'?emptyStudioOpportunities:params.get('opps')==='pending'?pendingStudioOpportunities:savedStudioOpportunities;
const inspector=params.has('reads')?{documents:{items:[{id:'fixture-doc',label:'Approved brand facts',versionId:'fixture-version-2',versionNumber:2,approvedAt:'2026-10-27T04:00:00Z',importedAt:'2026-10-26T04:00:00Z'}],truncated:false},searchConsole:{kind:params.get('gsc')||'synced',dataThrough:'2026-10-26'}}:undefined;
const live=params.has('live')?{cap:Number(params.get('live')),platforms:params.has('free')?[]:['gemini-flash','gpt-4o']}:undefined;
const attachCandidates=params.get('attach')==='empty'?[]:params.get('attach')==='unavailable'?null:[{id:'33333333-3333-4333-8333-333333333333',label:'Approved brand facts',versionNumber:2,contentHash:'${'a'.repeat(64)}'}];
createRoot(document.getElementById('root')).render(React.createElement(NextIntlClientProvider,{locale,messages:locale==='en'?en:zh,timeZone:'UTC'},React.createElement(ConversationStudio,{brandName:'Example Brand',clientId:'11111111-1111-4111-8111-111111111111',evidence,opportunities,live,inspector,attachCandidates,sourceStatus:params.has('reads')?'bound':'unavailable'})));`)
  await build({
    configFile: false, envDir: false, oxc: { jsx: { development: false } },
    resolve: { alias: { 'next/link': link, '@': resolve('.') } },
    define: { 'process.env.NODE_ENV': '"production"' },
    build: { outDir: resolve(directory), emptyOutDir: false, lib: { entry, name: 'StudioFixture', formats: ['iife'], fileName: () => 'fixture.js' } },
  })
  unlinkSync(entry)
  unlinkSync(link)
})
