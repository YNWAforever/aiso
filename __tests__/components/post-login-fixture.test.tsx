import { afterAll, expect, it, vi } from 'vitest'
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { build } from 'vite'
import { renderToStaticMarkup } from 'react-dom/server'
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), useParams: () => ({ clientId: 'fixture' }), useSearchParams: () => new URLSearchParams() }))
import { PostLoginScanFixture, fixtureBrand } from '../../tests/fixtures/post-login-scan'

it('renders real Results with report creation and saved-scan choices', () => {
  const html = renderToStaticMarkup(<PostLoginScanFixture href={`https://scan-ux.fixture/en/dashboard/${fixtureBrand}?step=results&scanId=older-scan`} />)
  expect(html).toContain('reports/new?scanId=older-scan')
  expect(html).toContain('value="older-scan" selected=""')
})

afterAll(async () => {
  const dir = process.env.AISO_SCAN_UX_HTML_DIR
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  const router = join(resolve(dir), 'router.ts')
  const auth = join(resolve(dir), 'auth.ts')
  const entry = join(resolve(dir), 'entry.tsx')
  writeFileSync(router, `export const useRouter=()=>({push:url=>location.assign(url),replace:url=>location.assign(url)});export const useParams=()=>({lang:location.pathname.split('/')[1],clientId:${JSON.stringify(fixtureBrand)}});export const useSearchParams=()=>new URLSearchParams(location.search);`)
  writeFileSync(auth, `export const authClient={signOut:async()=>({error:null})};`)
  writeFileSync(entry, `import React from 'react';import{createRoot}from'react-dom/client';import{PostLoginScanFixture}from'@/tests/fixtures/post-login-scan';createRoot(document.getElementById('root')).render(React.createElement(PostLoginScanFixture,{href:location.href}));`)
  await build({ configFile: false, envDir: false, oxc: { jsx: { development: false } },
    resolve: { alias: [{ find: 'next/navigation', replacement: router }, { find: '@/lib/auth-client', replacement: auth }, { find: 'next/link', replacement: resolve('tests/fixtures/fixture-link.tsx') }, { find: '@', replacement: resolve('.') }] },
    define: { 'process.env.NODE_ENV': '"production"' },
    build: { outDir: resolve(dir), emptyOutDir: false, lib: { entry, name: 'ScanUx', formats: ['iife'], fileName: () => 'fixture.js' } },
  })
  for (const path of [router, auth, entry]) unlinkSync(path)
})
