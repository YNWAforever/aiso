import { afterAll, describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { build } from 'vite'
import {
  ObservationWorkspace,
  type ObservationCopy,
} from '@/components/observations/ObservationWorkspace'
import type { ObservationResponse } from '@/lib/observations/types'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'
import {ObservationDetailContent} from '@/components/observations/ObservationDetail'
import {projectObservationDetail} from '@/lib/observations/schema'

const clientId = '11111111-1111-4111-8111-111111111111'
const initial: ObservationResponse = {
  schemaVersion: 1,
  clientId,
  selectedWeek: '2026-09-01',
  weeks: ['2026-09-01'],
  questionsTruncated: true,
  questions: [
    {
      id: '22222222-2222-4222-8222-222222222222',
      question: 'Current question',
      category: null,
      language: null,
      isActive: null,
    },
  ],
  items: [
    {
      id: '33333333-3333-4333-8333-333333333333',
      sourceKind: 'pulse-metric',
      promptId: '22222222-2222-4222-8222-222222222222',
      question: 'Historical <script>alert(1)</script>',
      platform: 'ChatGPT',
      scanWeek: '2026-09-01',
      recordedAt: '2026-09-02T10:00:00Z',
      collectedAt: null,
      model: null,
      market: null,
      result: 'incomplete',
      hasAnswer: true,
      brandMentioned: null,
      currentPrompt: {
        id: '22222222-2222-4222-8222-222222222222',
        question: 'Current question',
        category: null,
        language: null,
        isActive: null,
      },
      limitations: ['model-unrecorded'],
    },
  ],
  counts: { recordedRows: 3, successfulRows: 1, incompleteRows: 2 },
  nextCursor: 'next',
}
const copyFor = (lang: string) =>
  (lang === 'en' ? en : zh).observations as ObservationCopy
const propsFor = (lang: string) => ({
  clientId,
  initial,
  copy: copyFor(lang),
  lang,
})
describe('observation workspace rendering', () => {
  it.each(['en','zh-HK'])('renders raw evidence as plain text and labels text URLs in %s',(lang)=>{
    const detail=projectObservationDetail({id:initial.items[0].id,prompt_id:null,question:'Frozen question',platform:'api-model',scan_week:'2026-09-21',
      created_at:null,raw_answer:'<script>alert(1)</script> https://example.com/page javascript:alert(1)',brand_mentioned:null,
      snapshot:{question:'Frozen question',language:'en',market:null,category:null},brand_snapshot:null,requested_model:'synthetic/requested',
      actual_model:'synthetic/served',collector:'openrouter_api',collector_version:'fixture.v1',provider_request_id:null,classifier_method:'literal',
      classifier_version:'fixture.v1',sentiment:'unknown',matched_text:[],classification_status:'fallback'})
    const html=renderToString(<ObservationDetailContent observation={detail} copy={copyFor(lang)}/>)
    expect(html).toContain('&lt;script&gt;');expect(html).not.toContain('<script>')
    expect(html).not.toContain('href="javascript:')
    expect(html).toContain(copyFor(lang).textLink);expect(html).toContain(copyFor(lang).apiSample)
    expect(html).toContain('synthetic/served');expect(html).toContain('openrouter_api')
  })
  it.each([
    ['web', 'groundingWeb'], ['native', 'groundingNative'], ['none', 'groundingNone'], [null, 'unknown'], ['guessed', 'unknown'],
  ] as const)('says how the answer was produced: %s', (grounding, key) => {
    for (const lang of ['en', 'zh-HK']) {
      const detail = projectObservationDetail({ id: initial.items[0].id, prompt_id: null, question: 'Q', platform: 'gpt-4o', scan_week: '2026-09-21',
        created_at: null, raw_answer: 'An answer.', brand_mentioned: null,
        snapshot: null, brand_snapshot: null, requested_model: null, actual_model: null, collector: null, collector_version: null,
        provider_request_id: null, classifier_method: null, classifier_version: null, sentiment: null, matched_text: [],
        classification_status: 'fallback', grounding })
      expect(detail.grounding ?? null).toBe(grounding === 'guessed' ? null : grounding)
      const copy = copyFor(lang)
      const html = renderToString(<ObservationDetailContent observation={detail} copy={copy} />)
      expect(html).toContain(`<dt class="text-sm text-muted-foreground">${copy.grounding}</dt><dd class="break-words">${copy[key]}</dd>`)
    }
  })
  it('has equal locale copy keys', () => {
    expect(Object.keys(en.observations).sort()).toEqual(
      Object.keys(zh.observations).sort(),
    )
  })
  it.each(['en', 'zh-HK'])(
    'explains absent answer, classification and prompt link in %s',
    (lang) => {
      const copy = copyFor(lang),
        html = renderToString(
          <ObservationWorkspace
            {...propsFor(lang)}
            initial={{
              ...initial,
              items: [
                {
                  ...initial.items[0],
                  recordedAt: null,
                  hasAnswer: false,
                  brandMentioned: null,
                  currentPrompt: null,
                },
              ],
            }}
          />,
        )
      for (const text of [
        copy.noAnswer,
        copy.classificationUnknown,
        copy.unknownRecordedAt,
        copy.unknownCollectionTime,
        copy.unknownMarket,
        copy.activityUnknown,
      ])
        expect(html).toContain(text)
      expect(html).not.toContain(copy.currentPrompt + ':')
      expect(html).not.toContain(copy.brandNotMentioned)
    },
  )
  it.each([true, false])(
    'shows the stored boolean classification %s',
    (brandMentioned) => {
      const html = renderToString(
        <ObservationWorkspace
          {...propsFor('en')}
          initial={{
            ...initial,
            items: [{ ...initial.items[0], brandMentioned }],
          }}
        />,
      )
      expect(html).toContain(
        brandMentioned
          ? en.observations.brandMentioned
          : en.observations.brandNotMentioned,
      )
    },
  )

  it.each(['en', 'zh-HK'])(
    'renders provenance, counts and historical/current labels in %s',
    (lang) => {
      const html = renderToString(<ObservationWorkspace {...propsFor(lang)} />)
      expect(html).toContain(copyFor(lang).unknownModel)
      expect(html).toContain(copyFor(lang).historicalQuestion)
      expect(html).toContain(copyFor(lang).currentPrompt)
      expect(html).toContain(copyFor(lang).questionsTruncated)
      expect(html).not.toContain('<script>alert')
    },
  )
  it('shows recorded date, nullable classification, retained-week boundary and incomplete denominator', () => {
    const html = renderToString(<ObservationWorkspace {...propsFor('en')} />)
    expect(html).toContain('2026-09-02T10:00:00Z')
    expect(html).toContain('Classification unknown')
    expect(html).toContain('2 incomplete rows')
    expect(html).toContain('Latest 40 retained weeks')
  })
  it('distinguishes no data from no matches', () => {
    const html = renderToString(
      <ObservationWorkspace
        {...propsFor('en')}
        initial={{ ...initial, selectedWeek: null, weeks: [], items: [] }}
      />,
    )
    expect(html).toContain('No observations have been recorded')
  })
  it('renders empty and nullable evidence without inventing failure', () => {
    const html = renderToString(
      <ObservationWorkspace
        {...propsFor('en')}
        initial={{
          ...initial,
          items: [],
          counts: { recordedRows: 0, successfulRows: 0, incompleteRows: 0 },
          nextCursor: null,
        }}
      />,
    )
    expect(html).toContain(copyFor('en').empty)
  })
  it.each(['en', 'zh-HK'])(
    'accepts a bounded custom platform outside the first page in %s',
    (lang) => {
      const html = renderToString(<ObservationWorkspace {...propsFor(lang)} />)
      expect(html).toContain('name="platform"')
      expect(html).toContain('list="observation-platforms"')
      expect(html).toContain(copyFor(lang).applyPlatform)
      expect(html).toContain('aria-describedby="observation-platform-error"')
      expect(html).toContain('<datalist id="observation-platforms"')
    },
  )
})
afterAll(async () => {
  const dir = process.env.C9B_HTML_DIR
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  for (const lang of ['en', 'zh-HK']) {
    writeFileSync(join(dir, `${lang}-copy.json`), JSON.stringify(copyFor(lang)))
    writeFileSync(
      join(dir, `${lang}-default.html`),
      `<div id="root">${renderToString(<ObservationWorkspace {...propsFor(lang)} />)}</div><script id="fixture-props" type="application/json">${JSON.stringify(propsFor(lang)).replace(/</g, '\\u003c')}</script>`,
    )
  }
  const entry = join(resolve(dir), 'observation-entry.tsx')
  writeFileSync(
    entry,
    `import React,{useEffect} from 'react';import{hydrateRoot}from'react-dom/client';import{ObservationWorkspace}from '@/components/observations/ObservationWorkspace';function Fixture(){useEffect(()=>{window.observationFixtureReady=true},[]);return React.createElement(ObservationWorkspace,JSON.parse(document.getElementById('fixture-props').textContent))};hydrateRoot(document.getElementById('root'),React.createElement(Fixture));`,
  )
  await build({
    configFile: false,
    envDir: false,
    oxc: { jsx: { development: false } },
    resolve: { alias: { '@': resolve('.') } },
    define: { 'process.env.NODE_ENV': '"production"' },
    build: {
      outDir: resolve(dir),
      emptyOutDir: false,
      lib: {
        entry,
        name: 'ObservationFixture',
        formats: ['iife'],
        fileName: () => 'observation-fixture.js',
      },
    },
  })
  unlinkSync(entry)
})
