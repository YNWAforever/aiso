import { afterAll, expect, it } from 'vitest'
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { build } from 'vite'
import { ConversationStudio } from '@/components/dashboard/ConversationStudio'
import { renderWithIntl } from '@/__tests__/helpers/intl'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'
import { emptyStudioEvidence, savedStudioEvidence, savedStudioScan } from '@/__tests__/helpers/studio-evidence'
import { composeSavedReply } from '@/lib/conversation-studio/reply'
import { STUDIO_TEMPLATES } from '@/lib/conversation-studio/types'
import { StudioReplyView } from '@/components/dashboard/StudioReply'
import { StudioLiveReplyView } from '@/components/dashboard/StudioLiveReply'

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
  expect(empty).toContain(copy.noSources)
  expect(empty).toContain(copy.status.missing)
  expect(empty).toContain(copy.status.unsupported)
  const html = renderWithIntl(<StudioReplyView id="saved" evidence={savedStudioEvidence} reply={composeSavedReply('pulse', 'pulse', savedStudioEvidence)} />, lang)
  expect(html).toContain(copy.savedSummary)
  expect(html).toContain(copy.historicalQuote)
  expect(html).toContain(copy.searchUnknown)
  expect(html).toContain('https://example.com/bread')
  expect(html).toContain(savedStudioEvidence.observations[0].id)
  expect(html).toContain('2026-10-27T03:00:00Z')
  expect(html).not.toContain('Live answers with evidence are coming in Stage B')
  const scanData = { ...emptyStudioEvidence, scan: savedStudioScan }
  const scanHtml = renderWithIntl(<StudioReplyView id="scan" evidence={scanData} reply={composeSavedReply('brief', 'brief', scanData)} />, lang)
  expect(scanHtml).toContain('owned-scan-evidence')
  expect(scanHtml).toContain(savedStudioScan!.id)
  expect(scanHtml).toContain('c1_robots')
})

it.each(['en', 'zh-HK'])('renders live disabled/plan states and safe, unverified output in %s', lang => {
  const copy = (lang === 'en' ? en : zh).conversationStudio.live
  const ui = (cap: number, platforms = ['gemini-flash']) => renderWithIntl(<ConversationStudio brandName="Brand" clientId="brand-id" evidence={emptyStudioEvidence} live={{ cap, platforms }} />, lang)
  expect(ui(0)).toContain(copy.disabled)
  expect(ui(2)).toContain('gemini-flash')
  expect(ui(2)).not.toContain('gpt-4o')
  expect(ui(2, [])).toContain(copy.upgrade)
  expect(ui(2)).toContain(copy.temporaryCap)
  const html = renderWithIntl(<StudioLiveReplyView reply={{ quota: { cap: 2, remaining: 1, scope: 'process' }, answers: [{
    platform: 'gemini-flash', coverage: 'present', answer: '<script>unsafe</script>', model: 'mock-model',
    startedAt: '2026-10-28T00:00:00Z', durationMs: 123, finishReason: 'length', grounding: 'none',
    searchEvidence: { requested: 'none', execution: 'unknown', basis: 'request-only' }, error: null,
    citations: [{ url: 'javascript:alert(1)', title: 'Unsafe' }, { url: 'https://source.example/', title: 'Source' }],
  }] }} />, lang)
  expect(html).toContain(copy.unverified)
  expect(html).toContain(copy.searchUnknown)
  expect(html).toContain('mock-model')
  expect(html).toContain('length')
  expect(html).not.toContain('<script>')
  expect(html).not.toContain('javascript:')
  expect(html).toContain('href="https://source.example/"')
})

// Real interactive production component in an offline browser fixture. This
// never bypasses dashboard authentication or constructs SQL/Auth clients.
afterAll(async () => {
  const directory = process.env.STUDIO_HTML_DIR
  if (!directory) return
  mkdirSync(directory, { recursive: true })
  const entry = join(resolve(directory), 'entry.tsx')
  writeFileSync(entry, `import React from 'react';
import {createRoot} from 'react-dom/client';
import {NextIntlClientProvider} from 'next-intl';
import {ConversationStudio} from '@/components/dashboard/ConversationStudio';
import {emptyStudioEvidence,savedStudioEvidence,savedStudioScan} from '@/__tests__/helpers/studio-evidence';
import en from '@/messages/en.json'; import zh from '@/messages/zh-HK.json';
const locale=document.documentElement.lang;
const evidence=location.search.includes('empty=1')?emptyStudioEvidence:location.search.includes('scan=1')?{...savedStudioEvidence,scan:savedStudioScan}:savedStudioEvidence;
const params=new URLSearchParams(location.search);
const live=params.has('live')?{cap:Number(params.get('live')),platforms:params.has('free')?[]:['gemini-flash','gpt-4o']}:undefined;
createRoot(document.getElementById('root')).render(React.createElement(NextIntlClientProvider,{locale,messages:locale==='en'?en:zh,timeZone:'UTC'},React.createElement(ConversationStudio,{brandName:'Example Brand',clientId:'11111111-1111-4111-8111-111111111111',evidence,live})));`)
  await build({
    configFile: false, envDir: false, oxc: { jsx: { development: false } },
    resolve: { alias: { '@': resolve('.') } },
    define: { 'process.env.NODE_ENV': '"production"' },
    build: { outDir: resolve(directory), emptyOutDir: false, lib: { entry, name: 'StudioFixture', formats: ['iife'], fileName: () => 'fixture.js' } },
  })
  unlinkSync(entry)
})
