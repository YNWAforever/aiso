import { afterAll, expect, it, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { build } from 'vite'
vi.mock('@neondatabase/auth/next', () => ({ createAuthClient: () => ({}) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }))
import { LoginForm } from '@/components/auth/LoginForm'
import { AuthComplete } from '@/components/auth/AuthComplete'
const render = (lang: string, mode: string) => renderToString(<NextIntlClientProvider locale={lang} timeZone="UTC" messages={{}}>{mode === 'login' ? <LoginForm next={`/${lang}/dashboard`} /> : <AuthComplete lang={lang} next={`/${lang}/dashboard`} />}</NextIntlClientProvider>)
it('renders both localized login and completion without initiating a provider action', () => {
  expect(render('en', 'login')).toContain('Continue with Google')
  expect(render('zh-HK', 'complete')).toContain('正在為你登入')
})
afterAll(async () => {
  const dir = process.env.AUTH_RETURN_HTML_DIR
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  for (const lang of ['en', 'zh-HK']) for (const mode of ['login', 'complete']) writeFileSync(join(dir, `${lang}-${mode}.html`), `<main><h1>${lang === 'en' ? 'Sign-in fixture' : '登入測試'}</h1><div id="root">${render(lang, mode)}</div></main><script id="fixture-props" type="application/json">${JSON.stringify({ lang, mode })}</script>`)
  const client = join(resolve(dir), 'client.ts'), router = join(resolve(dir), 'router.ts'), entry = join(resolve(dir), 'entry.tsx')
  // Test adapter records intent only: no email, OAuth redirect or session cookie is sent.
  writeFileSync(client, `export{buildAuthCompleteUrl}from ${JSON.stringify(resolve('lib/auth-client.ts').replaceAll('\\', '/'))};export const authClient={signIn:{social:async input=>{window.lastAuth={flow:'google',...input};return{error:null}},magicLink:async input=>{window.lastAuth={flow:'magic-link',...input};return{error:null}}},getSession:async()=>{window.fixtureVerifier=new URL(location.href).searchParams.get('neon_auth_session_verifier');return{data:new URL(location.href).searchParams.has('fixture-failed')?null:{session:{id:'synthetic-session'}}}}};`)
  writeFileSync(router, `export const useRouter=()=>({replace:url=>location.assign(url)});`)
  writeFileSync(entry, `import React,{useEffect}from'react';import{hydrateRoot}from'react-dom/client';import{NextIntlClientProvider}from'next-intl';import{LoginForm}from'@/components/auth/LoginForm';import{AuthComplete}from'@/components/auth/AuthComplete';const d=JSON.parse(document.getElementById('fixture-props').textContent);function Fixture(){useEffect(()=>{window.authReturnReady=true},[]);const next=new URL(location.href).searchParams.get('next');return React.createElement(NextIntlClientProvider,{locale:d.lang,messages:{},timeZone:'UTC'},React.createElement(d.mode==='login'?LoginForm:AuthComplete,{lang:d.lang,next}))};hydrateRoot(document.getElementById('root'),React.createElement(Fixture));`)
  await build({ configFile: false, envDir: false, oxc: { jsx: { development: false } }, resolve: { alias: [{ find: '@/lib/auth-client', replacement: client }, { find: 'next/navigation', replacement: router }, { find: '@', replacement: resolve('.') }] }, define: { 'process.env.NODE_ENV': '"production"' }, build: { outDir: resolve(dir), emptyOutDir: false, lib: { entry, name: 'AuthReturnFixture', formats: ['iife'], fileName: () => 'fixture.js' } } })
  for (const path of [client, router, entry]) unlinkSync(path)
})
