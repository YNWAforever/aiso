import { afterAll, expect, it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { build } from 'vite'
import { ConversationStudio } from '@/components/dashboard/ConversationStudio'
import { renderWithIntl } from '@/__tests__/helpers/intl'
import { savedStudioEvidence } from '@/__tests__/helpers/studio-evidence'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'

it.each(['en', 'zh-HK'])('keeps the actual chat composer editable before an explicit Send in %s', lang => {
  const copy = (lang === 'en' ? en : zh).conversationStudio
  const html = renderWithIntl(<ConversationStudio brandName="Chat fixture brand" clientId="11111111-1111-4111-8111-111111111111" evidence={savedStudioEvidence} smeCopilot initialDraft="A question carried from Today" live={{ platforms: ['gemini-flash'], cap: 10 }} />, lang)
  expect(html).toContain('A question carried from Today')
  expect(html).toContain(copy.oneTapHint)
  expect(html).toContain(copy.live.composerHelp.replace(/'/g, '&#x27;'))
  expect(html).not.toContain('role="log"')
})

// Production React components and fetch transports, with Next navigation replaced
// only for this offline origin. The browser spec supplies isolated HTTP responses;
// the fixture never calls a database, a real provider or an authenticated service.
afterAll(async () => {
  const directory = resolve(process.env.STUDIO_HTML_DIR ?? '.next/component-fixtures/STUDIO')
  mkdirSync(directory, { recursive: true })
  const entry = join(directory, 'chat-entry.tsx')
  const navigation = join(directory, 'chat-navigation.tsx')
  const link = join(directory, 'chat-link.tsx')
  writeFileSync(navigation, `export function useRouter(){return {push:href=>{history.pushState(null,'',href);window.dispatchEvent(new PopStateEvent('popstate'))},refresh:()=>location.reload()}}`)
  writeFileSync(link, `import React from 'react';export default function Link({prefetch,...props}){return <a {...props}/>}`)
  writeFileSync(entry, `import React from 'react';
import {createRoot} from 'react-dom/client';
import {NextIntlClientProvider} from 'next-intl';
import {ConversationStudio} from '@/components/dashboard/ConversationStudio';
import {StudioSessionProvider} from '@/components/dashboard/StudioSession';
import {readStudioTask} from '@/lib/conversation-studio/task-handoff';
import {savedStudioEvidence} from '@/__tests__/helpers/studio-evidence';
import en from '@/messages/en.json';import zh from '@/messages/zh-HK.json';
const lang=location.pathname.split('/')[1],clientId=location.pathname.split('/')[3];
const params=new URLSearchParams(location.search);
createRoot(document.getElementById('root')).render(<React.StrictMode><NextIntlClientProvider locale={lang} messages={lang==='zh-HK'?zh:en} timeZone="UTC"><StudioSessionProvider key={'fixture-owner:'+clientId} clientId={clientId}><div id="aiso-studio"><ConversationStudio brandName="Chat fixture brand" clientId={clientId} evidence={savedStudioEvidence} smeCopilot sourceStatus="unavailable" initialDraft={params.get('ask')||''} initialTask={readStudioTask(params.get('task') ?? undefined)} live={{platforms:['gemini-flash'],cap:10}}/></div></StudioSessionProvider></NextIntlClientProvider></React.StrictMode>);
`)
  await build({
    configFile: false, envDir: false, oxc: { jsx: { development: false } },
    resolve: { alias: { 'next/navigation': navigation, 'next/link': link, '@': resolve('.') } },
    define: { 'process.env.NODE_ENV': '"production"' },
    build: { outDir: directory, emptyOutDir: false, lib: { entry, name: 'StudioChatFixture', formats: ['iife'], fileName: () => 'chat-fixture.js', cssFileName: 'chat-build' } },
  })
})
