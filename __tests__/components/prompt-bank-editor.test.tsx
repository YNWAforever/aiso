import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { NextIntlClientProvider } from 'next-intl'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, describe, expect, it } from 'vitest'
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { build } from 'vite'

import { PromptBankEditor } from '@/components/pulse/PromptBankEditor'
import { PROMPT_CATEGORIES } from '@/lib/prompts/categories'
import type { PromptBankItem } from '@/lib/types'

function messages(locale: 'en' | 'zh-HK') {
  return JSON.parse(readFileSync(join(process.cwd(), `messages/${locale}.json`), 'utf8'))
}

function prompt(overrides: Partial<PromptBankItem> = {}): PromptBankItem {
  return {
    id: 'p1', client_id: 'client-1', category: 'brand_query',
    question: 'What is AcmeCo?', language: 'en', is_active: true,
    created_at: '2026-08-01T00:00:00Z', ...overrides,
  }
}

function render(prompts: PromptBankItem[], locale: 'en' | 'zh-HK' = 'en') {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={messages(locale)} timeZone="UTC">
      <PromptBankEditor clientId="client-1" prompts={prompts} onPromptsChange={() => {}} />
    </NextIntlClientProvider>,
  )
}

describe('PromptBankEditor category vocabulary', () => {
  it('keeps legacy language text visible and labels it unknown', () => {
    const html = render([prompt({ language: 'legacy-ambiguous' })], 'zh-HK')
    expect(html).toContain('語言未知 (legacy-ambiguous)')
    expect(html).toContain('value="zh-HK" selected=""')
  })
  it('names each switch with its question and exposes active state', () => {
    const html = render([prompt()])
    expect(html).toContain('role="switch"')
    expect(html).toContain('aria-checked="true"')
    expect(html).toMatch(/aria-label="[^"]*What is AcmeCo\?/)
  })
  it('renders stored categories under a populated section, not an empty one', () => {
    // The bug this replaces: sections were keyed on display labels ('Brand
    // Queries') while rows carry 'brand_query', so every section rendered
    // empty and the real categories appeared beneath them as raw snake_case.
    const html = render([
      prompt({ id: 'p1', category: 'brand_query', question: 'Brand one' }),
      prompt({ id: 'p2', category: 'pain_point', question: 'Pain one' }),
    ])

    expect(html).toContain('Brand one')
    expect(html).toContain('Pain one')
    // The stored keys must never be shown to a user.
    expect(html).not.toContain('brand_query')
    expect(html).not.toContain('pain_point')
  })

  it('shows every canonical section, with a translated label', () => {
    const html = render([prompt()])
    const en = messages('en').pulse

    for (const category of PROMPT_CATEGORIES) {
      expect(html, `missing section for ${category}`).toContain(en[`cat_${category}`])
    }
  })

  it('counts each section from the rows actually in it', () => {
    const html = render([
      prompt({ id: 'p1', category: 'brand_query' }),
      prompt({ id: 'p2', category: 'brand_query' }),
    ])
    const en = messages('en').pulse
    const section = html.slice(html.indexOf(en.cat_brand_query))

    // The count badge immediately follows the section label.
    expect(section).toMatch(/>2</)
  })

  it('keeps a row with an unrecognised category visible under Other', () => {
    // The column is nullable and unconstrained, so live rows may hold values
    // the vocabulary has never known. Hiding them would strand data a user
    // cannot then delete.
    const html = render([prompt({ id: 'p1', category: 'legacy_value', question: 'Legacy one' })])

    expect(html).toContain('Legacy one')
    expect(html).toContain(messages('en').pulse.cat_other)
  })

  it('keeps a row with a null category visible rather than grouping it under "null"', () => {
    const html = render([prompt({ id: 'p1', category: null, question: 'No category' })])

    expect(html).toContain('No category')
    expect(html).not.toContain('>null<')
  })

  it('offers no add row for the uncategorised section', () => {
    // POST validates against the vocabulary, so adding there would 400.
    const withLegacy = render([prompt({ id: 'p1', category: 'legacy_value' })])
    const placeholder = messages('en').pulse.add_prompt_ph

    // Four canonical sections each get one add row; Other must not.
    const addRows = withLegacy.split(placeholder).length - 1
    expect(addRows).toBe(PROMPT_CATEGORIES.length)
  })

  it('translates the sections in zh-HK too', () => {
    const html = render([prompt()], 'zh-HK')
    const zh = messages('zh-HK').pulse

    expect(html).toContain(zh.cat_brand_query)
  })
})

afterAll(async () => {
  const dir = process.env.PROMPT_BANK_HTML_DIR
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  const prompts = [prompt(), prompt({ id: 'p2', category: 'pain_point', question: 'How can AcmeCo help?', is_active: false })]
  for (const locale of ['en', 'zh-HK'] as const) {
    const props = { locale, messages: messages(locale), prompts }
    writeFileSync(join(dir, `${locale}-copy.json`), JSON.stringify(messages(locale).pulse))
    writeFileSync(join(dir, `${locale}.html`), `<main><h1>${locale === 'en' ? 'Question bank' : '問題庫'}</h1><div id="root">${render(prompts, locale)}</div></main><script id="fixture-props" type="application/json">${JSON.stringify(props).replace(/</g, '\\u003c')}</script>`)
  }
  const entry = join(resolve(dir), 'prompt-entry.tsx')
  writeFileSync(entry, `import React,{useEffect,useState}from'react';import{hydrateRoot}from'react-dom/client';import{NextIntlClientProvider}from'next-intl';import{PromptBankEditor}from'@/components/pulse/PromptBankEditor';const d=JSON.parse(document.getElementById('fixture-props').textContent);function Fixture(){const[rows,setRows]=useState(d.prompts);useEffect(()=>{window.promptFixtureReady=true},[]);return React.createElement(NextIntlClientProvider,{locale:d.locale,messages:d.messages,timeZone:'UTC'},React.createElement(PromptBankEditor,{clientId:'client-1',prompts:rows,onPromptsChange:setRows}))};hydrateRoot(document.getElementById('root'),React.createElement(Fixture));`)
  await build({ configFile: false, envDir: false, oxc: { jsx: { development: false } }, resolve: { alias: { '@': resolve('.') } }, define: { 'process.env.NODE_ENV': '"production"' }, build: { outDir: resolve(dir), emptyOutDir: false, lib: { entry, name: 'PromptFixture', formats: ['iife'], fileName: () => 'fixture.js' } } })
  unlinkSync(entry)
})

describe('prompt category message parity', () => {
  it('labels every category in both locales', () => {
    // Catches both a missing translation and a category added to the
    // vocabulary without labels.
    for (const locale of ['en', 'zh-HK'] as const) {
      const pulse = messages(locale).pulse
      for (const category of PROMPT_CATEGORIES) {
        expect(pulse[`cat_${category}`], `${locale} is missing cat_${category}`).toBeTruthy()
      }
      expect(pulse.cat_other, `${locale} is missing cat_other`).toBeTruthy()
    }
  })
})

describe('PromptBankEditor failure handling', () => {
  it('reverts every optimistic mutation when the server refuses', () => {
    // Closing the entitlement hole means a Basic user's toggle now 403s. Without
    // a revert the UI shows a change that was never persisted and the next
    // reload silently undoes it.
    const source = readFileSync(
      join(process.cwd(), 'components/pulse/PromptBankEditor.tsx'), 'utf8',
    )

    expect(source).toContain('revertOn')
    expect(source).toContain('onPromptsChange')
    // All three mutations must go through it, not just the one that is easy.
    expect(source.match(/await revertOn\(/g) ?? []).toHaveLength(3)
    expect(source).toContain("t('qb_save_failed')")
  })

  it('only dismisses an accepted suggestion when the write actually happened', () => {
    // It used to fire-and-forget the POST and dismiss unconditionally, so a
    // refused write made the suggestion disappear having been saved nowhere.
    const panel = readFileSync(
      join(process.cwd(), 'components/pulse/SuggestQuestionsPanel.tsx'), 'utf8',
    )
    const accept = panel.slice(panel.indexOf('async function accept'))

    expect(accept).toContain('if (!res.ok)')
    // The early return must come before the dismissal, not after it.
    expect(accept.indexOf('return')).toBeLessThan(accept.indexOf('setDismissed'))
    expect(accept).toContain("t('qb_limit_reached'")
  })

  it('hands back the row the server created, not the text that was sent', () => {
    // The parent used to fabricate a `temp-` id from the strings, so the new
    // question could never be edited or deleted — no such prompt existed.
    const panel = readFileSync(
      join(process.cwd(), 'components/pulse/SuggestQuestionsPanel.tsx'), 'utf8',
    )
    // Comments stripped: the fix is explained in a comment that names the very
    // string this asserts is gone, and prose must not fail a behavioural check.
    const section = readFileSync(
      join(process.cwd(), 'components/pulse/QuestionBankSection.tsx'), 'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

    expect(panel).toContain('const { prompt } = await res.json()')
    expect(panel).toContain('onAccepted(prompt)')
    expect(section).not.toContain('temp-')
  })

  it('keeps one list, so the panel and the editor cannot disagree', () => {
    // QuestionBankSection owned a copy and PromptBankEditor seeded its own from
    // it, so accepting a suggestion moved the header count and nothing else.
    const section = readFileSync(
      join(process.cwd(), 'components/pulse/QuestionBankSection.tsx'), 'utf8',
    )

    expect(section).toContain('onPromptsChange={setPrompts}')
    expect(section).toContain('prompts={prompts}')
  })

  it('reports the cap distinctly from a generic failure', () => {
    const source = readFileSync(
      join(process.cwd(), 'components/pulse/PromptBankEditor.tsx'), 'utf8',
    )

    expect(source).toContain('res.status === 409')
    expect(source).toContain("t('qb_limit_reached'")
  })
})
