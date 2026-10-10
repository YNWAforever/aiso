import { afterAll, describe, it, expect } from 'vitest'
import { renderToString } from 'react-dom/server'
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { build } from 'vite'
import { DomainVerificationPanel, type DomainVerificationView } from '@/components/entities/DomainVerificationPanel'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'

const initial: DomainVerificationView = { state: 'unverified', domain: 'proof.fixture', token: null, path: '/.well-known/aiso-site-verification.txt', lastCheckedAt: null, lastOutcome: null }
const token = 'aiso-site-verification=0123456789abcdef0123456789abcdef'
const copyFor = (lang: string) => (lang === 'en' ? en : zh).entities
const propsFor = (lang: string, saved = false) => ({ clientId: '11111111-1111-4111-8111-111111111111', initial: saved ? { ...initial, token, state: 'verified' as const, lastOutcome: 'verified' as const, lastCheckedAt: '2026-10-03T00:00:00Z' } : initial, copy: copyFor(lang) })

describe('domain verification first use', () => {
  it.each(['en', 'zh-HK'])('requires content before offering a probe in %s', lang => {
    const html = renderToString(<DomainVerificationPanel {...propsFor(lang)} />)
    expect(html).not.toContain(copyFor(lang).verifyCheck)
    expect(html).not.toContain('<dl')
  })
  it('keeps an existing proof and content ready without a write', () => {
    const html = renderToString(<DomainVerificationPanel {...propsFor('en', true)} />)
    expect(html).toContain(token)
    expect(html).toContain(en.entities.verifyOutcomeVerified)
  })
})

afterAll(async () => {
  const dir = process.env.C9A_HTML_DIR
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  for (const lang of ['en', 'zh-HK']) {
    writeFileSync(join(dir, `${lang}-copy.json`), JSON.stringify(copyFor(lang)))
    for (const saved of [false, true]) {
      const props = propsFor(lang, saved)
      writeFileSync(join(dir, `${lang}-verification${saved ? '-saved' : ''}.html`), `<main><h1>${copyFor(lang).title}</h1><div id="root">${renderToString(<DomainVerificationPanel {...props} />)}</div></main><script id="fixture-props" type="application/json">${JSON.stringify(props).replace(/</g, '\\u003c')}</script>`)
    }
  }
  const entry = join(resolve(dir), 'verification-entry.tsx')
  writeFileSync(entry, `import React,{useEffect}from'react';import{hydrateRoot}from'react-dom/client';import{DomainVerificationPanel}from'@/components/entities/DomainVerificationPanel';function Fixture(props){useEffect(()=>{window.entityFixtureReady=true},[]);return React.createElement(DomainVerificationPanel,props)};const root=hydrateRoot(document.getElementById('root'),React.createElement(Fixture,JSON.parse(document.getElementById('fixture-props').textContent)));window.entityFixtureSwitch=props=>root.render(React.createElement(Fixture,props));`)
  await build({ configFile: false, envDir: false, oxc: { jsx: { development: false } }, resolve: { alias: { '@': resolve('.') } }, define: { 'process.env.NODE_ENV': '"production"' }, build: { outDir: resolve(dir), emptyOutDir: false, lib: { entry, name: 'VerificationFixture', formats: ['iife'], fileName: () => 'verification-fixture.js' } } })
  unlinkSync(entry)
})
