import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { build } from 'vite'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'
export async function writeC9cFixture(
  slice: string,
  component: string,
  module: string,
  props: object,
  html: (lang: string) => string,
  variants: Record<
    string,
    { props: object; html: (lang: string) => string }
  > = {},
  namespace: 'opportunities' | 'changeSets' | 'approverAccess' | 'delivery' | 'outcomes' = 'opportunities',
) {
  const dir = process.env[`${slice}_HTML_DIR`]
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  for (const lang of ['en', 'zh-HK']) {
    const messages = lang === 'en' ? en : zh
    writeFileSync(
      join(dir, `${lang}-copy.json`),
      JSON.stringify(messages[namespace]),
    )
    writeFileSync(join(dir, `${lang}-data.json`), JSON.stringify(props))
    writeFileSync(
      join(dir, `${lang}-default.html`),
      `<div id="root">${html(lang)}</div><script id="fixture-props" type="application/json">${JSON.stringify({ props, messages, lang }).replace(/</g, '\\u003c')}</script>`,
    )
  }
  for (const [name, variant] of Object.entries(variants)) {
    for (const lang of ['en', 'zh-HK']) {
      const messages = lang === 'en' ? en : zh
      writeFileSync(
        join(dir, `${lang}-${name}.html`),
        `<div id="root">${variant.html(lang)}</div><script id="fixture-props" type="application/json">${JSON.stringify({ props: variant.props, messages, lang }).replace(/</g, '\\u003c')}</script>`,
      )
    }
  }
  const entry = join(resolve(dir), 'entry.tsx')
  writeFileSync(
    entry,
    `import React,{useEffect}from'react';import{hydrateRoot}from'react-dom/client';import{NextIntlClientProvider}from'next-intl';import{${component}}from'${module}';const d=JSON.parse(document.getElementById('fixture-props').textContent);function Fixture(){useEffect(()=>{window.c9cFixtureReady=true},[]);const c=React.createElement(${component},{...d.props,onSaved:()=>{}});return React.createElement(NextIntlClientProvider,{locale:d.lang,messages:d.messages,timeZone:"UTC"},${component === 'DraftEditor' ? "React.createElement('main',null,React.createElement('h1',null,'Draft fixture'),c)" : 'c'})}hydrateRoot(document.getElementById('root'),React.createElement(Fixture));`,
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
        name: 'C9cFixture',
        formats: ['iife'],
        fileName: () => 'fixture.js',
      },
    },
  })
  unlinkSync(entry)
}
