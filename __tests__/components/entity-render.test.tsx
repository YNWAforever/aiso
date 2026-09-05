import { afterAll, describe, it, expect } from 'vitest'
import { renderToString } from 'react-dom/server'
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { build } from 'vite'
import {
  EntityEditor,
  type EntityCopy,
} from '@/components/entities/EntityEditor'
import type { EntityDto } from '@/lib/entities/schema'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'

const clientId = '11111111-1111-4111-8111-111111111111'
const saved: EntityDto = {
  clientId,
  displayName: 'Example identity',
  aliases: ['Example alias'],
  revision: 1,
  verification: 'unverified',
  updatedAt: '2026-09-06T00:00:00Z',
}
const copyFor = (lang: string): EntityCopy => (lang === 'en' ? en : zh).entities
const propsFor = (lang: string, state: string) => ({
  clientId,
  brandName: 'Example Brand',
  initialEntity: state === 'saved' ? saved : null,
  copy: copyFor(lang),
})
const render = (lang: string, state: string) =>
  renderToString(<EntityEditor {...propsFor(lang, state)} />)
describe('entity localized rendering', () => {
  it.each(['en', 'zh-HK'])('renders private unverified state in %s', (lang) => {
    expect(render(lang, 'empty')).toContain(copyFor(lang).unsaved)
    expect(render(lang, 'saved')).toContain(copyFor(lang).saved)
    expect(render(lang, 'saved')).toContain(copyFor(lang).unverified)
  })
})
afterAll(async () => {
  const dir = process.env.C9A_HTML_DIR
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  for (const lang of ['en', 'zh-HK']) {
    writeFileSync(join(dir, `${lang}-copy.json`), JSON.stringify(copyFor(lang)))
    for (const state of ['empty', 'saved'])
      writeFileSync(
        join(dir, `${lang}-${state}.html`),
        `<div id="root">${render(lang, state)}</div><script id="fixture-props" type="application/json">${JSON.stringify(propsFor(lang, state)).replace(/</g, '\\u003c')}</script>`,
      )
  }
  const entry = join(resolve(dir), 'entity-entry.tsx')
  writeFileSync(
    entry,
    `import React from 'react';import {hydrateRoot} from 'react-dom/client';import {EntityEditor} from '@/components/entities/EntityEditor';const root=hydrateRoot(document.getElementById('root'),React.createElement(EntityEditor,JSON.parse(document.getElementById('fixture-props').textContent)));window.entityFixtureSwitch=(props)=>root.render(React.createElement(EntityEditor,props));window.entityFixtureReady=true;`,
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
        name: 'EntityFixture',
        formats: ['iife'],
        fileName: () => 'entity-fixture.js',
      },
    },
  })
  unlinkSync(entry)
})
