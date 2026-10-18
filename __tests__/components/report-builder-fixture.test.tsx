import { afterAll, expect, it } from 'vitest'
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { renderToString } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import { ReportBuilder } from '@/components/reports/ReportBuilder'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'
import { reportBuilderProps } from './report-builder-fixtures'

function markup(lang: 'en' | 'zh-HK', existing: boolean) {
  const props = reportBuilderProps(lang, existing)
  return renderToString(
    <NextIntlClientProvider locale={lang} messages={lang === 'en' ? en : zh} timeZone="UTC">
      <ReportBuilder {...props} />
    </NextIntlClientProvider>,
  )
}

it.each(['en', 'zh-HK'] as const)('report fixture labels its synthetic evidence in %s', lang => {
  const html = markup(lang, false)
  expect(html).toContain(lang === 'en' ? 'Synthetic report brand' : '合成報告品牌')
  expect(html).toContain('example.test')
  expect(html).toContain(reportBuilderProps(lang, false).initialSnapshot.executiveSummary)
})

// Emit only when explicitly requested by the offline acceptance runner.
afterAll(async () => {
  const dir = process.env.AISO_REPORT_HTML_DIR
  if (!dir) return
  const { build } = await import('vite')
  mkdirSync(dir, { recursive: true })
  for (const lang of ['en', 'zh-HK'] as const) {
    for (const existing of [false, true]) {
      const data = { props: reportBuilderProps(lang, existing), messages: lang === 'en' ? en : zh, lang }
      writeFileSync(join(dir, `${lang}-${existing ? 'existing' : 'new'}.html`),
        `<div id="root">${markup(lang, existing)}</div><script id="fixture-props" type="application/json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`)
    }
  }
  const entry = join(resolve(dir), 'entry.tsx')
  writeFileSync(entry, `
import React,{useEffect} from 'react';
import {hydrateRoot} from 'react-dom/client';
import {NextIntlClientProvider} from 'next-intl';
import {ReportBuilder} from '@/components/reports/ReportBuilder';
const d=JSON.parse(document.getElementById('fixture-props').textContent);
function Fixture(){
  useEffect(()=>{window.reportFixtureReady=true},[]);
  return React.createElement(NextIntlClientProvider,{locale:d.lang,messages:d.messages,timeZone:'UTC'},
    React.createElement(ReportBuilder,d.props));
}
hydrateRoot(document.getElementById('root'),React.createElement(Fixture));
`)
  await build({
    configFile: false,
    envDir: false,
    oxc: { jsx: { development: false } },
    resolve: { alias: { '@': resolve('.') } },
    define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
    build: {
      outDir: resolve(dir), emptyOutDir: false,
      lib: { entry, name: 'ReportFixture', formats: ['iife'], fileName: () => 'fixture.js' },
    },
  })
  unlinkSync(entry)
})
