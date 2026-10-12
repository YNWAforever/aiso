import { mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { NextIntlClientProvider } from 'next-intl'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, describe, expect, it } from 'vitest'
import { build } from 'vite'
import { SuggestQuestionsPanel } from '@/components/pulse/SuggestQuestionsPanel'
import { QuestionBankSection } from '@/components/pulse/QuestionBankSection'

describe('suggestion panel modal contract', () => {
  for (const locale of ['en', 'zh-HK'] as const) {
    it(`names the modal and close control in ${locale}`, () => {
      const messages = JSON.parse(readFileSync(`messages/${locale}.json`, 'utf8'))
      const html = renderToStaticMarkup(<NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC">
        <SuggestQuestionsPanel clientId="client-1" onClose={() => {}} onAccepted={() => {}} onError={() => {}} />
      </NextIntlClientProvider>)
      const titleId = html.match(/<dialog[^>]*aria-labelledby="([^"]+)"/)?.[1]
      expect(titleId).toBeTruthy()
      expect(html).toContain(`id="${titleId}"`)
      expect(html).toContain(messages.pulse.panel_title)
      expect(html).toContain(`aria-label="${locale === 'en' ? 'Close question suggestions' : '關閉問題建議'}"`)
    })
  }
})

afterAll(async () => {
  const dir = process.env.PROMPT_BANK_HTML_DIR
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  for (const locale of ['en', 'zh-HK'] as const) {
    const messages = JSON.parse(readFileSync(`messages/${locale}.json`, 'utf8'))
    const props = { clientId: 'client-1', initialPrompts: [], isFirstTime: false, contextDefaults: { language: locale, market: 'HK' } }
    const html = renderToStaticMarkup(<NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC"><QuestionBankSection {...props} /></NextIntlClientProvider>)
    writeFileSync(join(dir, `${locale}-suggestions.html`), `<main><h1>Question suggestions</h1><div id="root">${html}</div></main><script id="fixture-props" type="application/json">${JSON.stringify({ locale, messages, props }).replace(/</g, '\\u003c')}</script>`)
    writeFileSync(join(dir, `${locale}-copy.json`), JSON.stringify(messages.pulse))
  }
  const entry = join(resolve(dir), 'suggestions-entry.tsx')
  writeFileSync(entry, `import React,{useEffect}from'react';import{hydrateRoot}from'react-dom/client';import{NextIntlClientProvider}from'next-intl';import{QuestionBankSection}from'@/components/pulse/QuestionBankSection';const d=JSON.parse(document.getElementById('fixture-props').textContent);function Fixture(){useEffect(()=>{window.suggestionFixtureReady=true},[]);return React.createElement(NextIntlClientProvider,{locale:d.locale,messages:d.messages,timeZone:'UTC'},React.createElement(QuestionBankSection,d.props))};hydrateRoot(document.getElementById('root'),React.createElement(Fixture));`)
  await build({ configFile: false, envDir: false, oxc: { jsx: { development: false } }, resolve: { alias: { '@': resolve('.') } }, define: { 'process.env.NODE_ENV': '"production"' }, build: { outDir: resolve(dir), emptyOutDir: false, lib: { entry, name: 'SuggestionFixture', formats: ['iife'], fileName: () => 'suggestions.js' } } })
  unlinkSync(entry)
})
