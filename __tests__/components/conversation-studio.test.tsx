import { afterAll, expect, it } from 'vitest'
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { build } from 'vite'
import { ConversationStudio } from '@/components/dashboard/ConversationStudio'
import { renderWithIntl } from '@/__tests__/helpers/intl'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'

it.each(['en', 'zh-HK'])('renders an honest empty demo with templates, composer and thread list in %s', lang => {
  const copy = (lang === 'en' ? en : zh).conversationStudio
  const html = renderWithIntl(<ConversationStudio brandName="Example Brand" />, lang)
  expect(html).toContain(copy.title)
  expect(html).toContain('Example Brand')
  expect(html).toContain(copy.threadsEmpty)
  expect(html).toContain(copy.privacyBody)
  expect(html).toContain(copy.demoNotice)
  expect(html).toContain('<textarea')
  for (const key of ['visibility', 'content', 'competitors'] as const) expect(html).toContain(copy.templates[key].label)
  expect(html).not.toContain('<form action=')
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
import en from '@/messages/en.json'; import zh from '@/messages/zh-HK.json';
const locale=document.documentElement.lang;
createRoot(document.getElementById('root')).render(React.createElement(NextIntlClientProvider,{locale,messages:locale==='en'?en:zh,timeZone:'UTC'},React.createElement(ConversationStudio,{brandName:'Example Brand'})));`)
  await build({
    configFile: false, envDir: false, oxc: { jsx: { development: false } },
    resolve: { alias: { '@': resolve('.') } },
    define: { 'process.env.NODE_ENV': '"production"' },
    build: { outDir: resolve(directory), emptyOutDir: false, lib: { entry, name: 'StudioFixture', formats: ['iife'], fileName: () => 'fixture.js' } },
  })
  unlinkSync(entry)
})
