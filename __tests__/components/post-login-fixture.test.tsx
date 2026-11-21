import { afterAll, expect, it, vi } from 'vitest'
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { build } from 'vite'
import { renderToStaticMarkup } from 'react-dom/server'
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), useParams: () => ({ clientId: 'fixture' }), useSearchParams: () => new URLSearchParams() }))
import { PostLoginScanFixture, fixtureBrand, fixtureScans, type FindingFixture } from '../../tests/fixtures/post-login-scan'

vi.mock('server-only', () => ({}))
import { buildScanEvidence } from '@/lib/scan-evidence'
import { deriveSuggestions } from '@/lib/opportunities/rules'
import { buildInitialDraftSnapshot } from '@/lib/work-items/snapshot'

const scans = fixtureScans.map((scan, i) => {
  const status = i === 0 ? 'pass' : 'fail'
  const evidence = buildScanEvidence({ requestedUrl: scan.url, evaluatedUrl: scan.url, industry: scan.industry, region: scan.region,
    sitemapSource: 'unknown', collectedAt: scan.created_at, checks: { c1_robots: { assessment: status, collection: 'complete' } },
    observations: [{ check: 'page', httpStatus: 200, collection: 'complete', target: { origin: 'https://example.invalid' } }] })
  return { ...scan, id: `00000000-0000-4000-8000-00000000000${i + 1}`, results: { ...scan.results, evidence, c1_robots: { status, message: status === 'pass' ? 'Crawler allowed' : 'Crawler blocked' } } } as typeof scan
})
const older = scans[1]!
const source = { kind: 'scan-check' as const, scanId: older.id, recordedAt: older.created_at, envelope: older.results.evidence }
const suggestion = deriveSuggestions(source)[0]!
const finding: FindingFixture = { scans, opportunities: { schemaVersion: 1, sourceStates: { pulse:'empty', scan:'ok' }, savedDraftsState:'ok', partial:false,
  window: { scanId: older.id, recordedAt:older.created_at, pulseWeek:null, pulseLimit:200, pulseTruncated:false },
  suggestions: [{ ...suggestion, savedState:'unsaved', saveAvailability:'available' }] } }

it('renders real Results with report creation and saved-scan choices', () => {
  const html = renderToStaticMarkup(<PostLoginScanFixture href={`https://scan-ux.fixture/en/dashboard/${fixtureBrand}?step=results&scanId=older-scan`} />)
  expect(html).toContain('reports/new?scanId=older-scan')
  expect(html).toContain('value="older-scan" selected=""')
})

afterAll(async () => {
  const dir = process.env.AISO_SCAN_UX_HTML_DIR
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'finding.json'), JSON.stringify({ response: finding.opportunities,
    snapshots: { en: buildInitialDraftSnapshot(suggestion,source,'en'), 'zh-HK': buildInitialDraftSnapshot(suggestion,source,'zh-HK') } }))
  const router = join(resolve(dir), 'router.ts')
  const auth = join(resolve(dir), 'auth.ts')
  const entry = join(resolve(dir), 'entry.tsx')
  writeFileSync(router, `export const useRouter=()=>({push:url=>location.assign(url),replace:url=>location.assign(url)});export const useParams=()=>({lang:location.pathname.split('/')[1],clientId:${JSON.stringify(fixtureBrand)}});export const useSearchParams=()=>new URLSearchParams(location.search);`)
  writeFileSync(auth, `export const authClient={signOut:async()=>({error:null})};`)
  writeFileSync(entry, `import React from 'react';import{createRoot}from'react-dom/client';import{PostLoginScanFixture}from'@/tests/fixtures/post-login-scan';createRoot(document.getElementById('root')).render(React.createElement(PostLoginScanFixture,{href:location.href,finding:${JSON.stringify(finding)}}));`)
  await build({ configFile: false, envDir: false, oxc: { jsx: { development: false } },
    resolve: { alias: [{ find: 'next/navigation', replacement: router }, { find: '@/lib/auth-client', replacement: auth }, { find: 'next/link', replacement: resolve('tests/fixtures/fixture-link.tsx') }, { find: '@', replacement: resolve('.') }] },
    define: { 'process.env.NODE_ENV': '"production"' },
    build: { outDir: resolve(dir), emptyOutDir: false, lib: { entry, name: 'ScanUx', formats: ['iife'], fileName: () => 'fixture.js' } },
  })
  for (const path of [router, auth, entry]) unlinkSync(path)
})
