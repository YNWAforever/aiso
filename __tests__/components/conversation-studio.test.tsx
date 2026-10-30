import { afterAll, expect, it } from 'vitest'
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { build } from 'vite'
import { ConversationStudio, StudioThreadHeader } from '@/components/dashboard/ConversationStudio'
import { renderWithIntl } from '@/__tests__/helpers/intl'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'
import { emptyStudioEvidence, savedStudioEvidence, savedStudioScan } from '@/__tests__/helpers/studio-evidence'
import { composeSavedReply } from '@/lib/conversation-studio/reply'
import { STUDIO_TEMPLATES } from '@/lib/conversation-studio/types'
import { StudioEvidenceRows } from '@/components/dashboard/StudioEvidenceInspector'
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
  expect(html).toContain('<textarea')
  for (const key of STUDIO_TEMPLATES) expect(html).toContain(copy.templates[key].label)
  expect(html).not.toContain('<form action=')
})
it.each(['en', 'zh-HK'])('starts on home with six tasks, five filters and no conversation log in %s', lang => {
  const html = renderWithIntl(<ConversationStudio brandName="Example Brand" evidence={emptyStudioEvidence} />, lang)
  expect(html).not.toContain('role="log"')
  expect(html.match(/class="as-template /g)).toHaveLength(6)
  expect(html.match(/aria-pressed="(?:true|false)"/g)).toHaveLength(5)
  expect(html).toContain('disabled=""') // document attachment stays held
  expect(html).not.toMatch(/Harbour Home|Harbour Tea|WI-DEMO/)
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
  const thread = { title: 'Source goal', goal: 'Original question', kind: 'research' as const, week: '2026-10-26' }
  const html = renderWithIntl(<StudioThreadHeader thread={thread} onHome={() => {}} />, lang)
  expect(html).toContain(copy.discussionEyebrow)
  expect(html).toContain('<h1 class="[overflow-wrap:anywhere]">Source goal</h1>')
  expect(html).toContain(copy.localeBadge)
  expect(html).toContain(copy.savedWeek.replace('{week}', thread.week))
  expect(html).not.toMatch(/28 days|產品資料|Selected documents/)
  const brief = renderWithIntl(<StudioThreadHeader thread={{ ...thread, kind: 'brief', week: null, sourceTitle: 'Source discussion' }} onHome={() => {}} />, lang)
  expect(brief).toContain(copy.briefEyebrow)
  expect(brief).toContain('Original question')
  expect(brief).toContain('Source discussion')
  expect(brief).toContain(copy.briefTemporary)
  expect(brief).not.toContain('2026-10-26')
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

it.each(['en', 'zh-HK'])('renders live disabled/plan states and safe, unverified output in %s', lang => {
  const copy = (lang === 'en' ? en : zh).conversationStudio.live
  const ui = (cap: number, platforms = ['gemini-flash']) => renderWithIntl(<ConversationStudio brandName="Brand" clientId="brand-id" evidence={emptyStudioEvidence} live={{ cap, platforms }} />, lang)
  expect(ui(0)).toContain(copy.disabled)
  expect(ui(2)).toContain('gemini-flash')
  expect(ui(2)).not.toContain('gpt-4o')
  expect(ui(2, [])).toContain(copy.upgrade)
  expect(ui(2)).toContain(copy.temporaryCap)
  const reply = { quota: { cap: 2, remaining: 1, scope: 'process' }, answers: [{
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
import en from '@/messages/en.json'; import zh from '@/messages/zh-HK.json';
const locale=document.documentElement.lang;
const evidence=location.search.includes('empty=1')?emptyStudioEvidence:location.search.includes('scan=1')?{...savedStudioEvidence,scan:savedStudioScan}:savedStudioEvidence;
const params=new URLSearchParams(location.search);
const inspector=params.has('reads')?{documents:{items:[{id:'fixture-doc',label:'Approved brand facts',versionId:'fixture-version-2',versionNumber:2,approvedAt:'2026-10-27T04:00:00Z',importedAt:'2026-10-26T04:00:00Z'}],truncated:false},searchConsole:{kind:params.get('gsc')||'synced',dataThrough:'2026-10-26'}}:undefined;
const live=params.has('live')?{cap:Number(params.get('live')),platforms:params.has('free')?[]:['gemini-flash','gpt-4o']}:undefined;
createRoot(document.getElementById('root')).render(React.createElement(NextIntlClientProvider,{locale,messages:locale==='en'?en:zh,timeZone:'UTC'},React.createElement(ConversationStudio,{brandName:'Example Brand',clientId:'11111111-1111-4111-8111-111111111111',evidence,live,inspector,sourceStatus:params.has('reads')?'bound':'unavailable'})));`)
  await build({
    configFile: false, envDir: false, oxc: { jsx: { development: false } },
    resolve: { alias: { 'next/link': link, '@': resolve('.') } },
    define: { 'process.env.NODE_ENV': '"production"' },
    build: { outDir: resolve(directory), emptyOutDir: false, lib: { entry, name: 'StudioFixture', formats: ['iife'], fileName: () => 'fixture.js' } },
  })
  unlinkSync(entry)
  unlinkSync(link)
})
