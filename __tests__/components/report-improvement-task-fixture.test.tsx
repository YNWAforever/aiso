import { afterAll, expect, it, vi } from 'vitest'
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
vi.mock('server-only', () => ({}))
import { ReportImprovementTasks, type ReportImprovementFinding } from '@/components/reports/ReportImprovementTasks'
import { buildReportFindingCandidates } from '@/lib/reports/finding-candidates'
import { buildInitialDraftSnapshot } from '@/lib/work-items/snapshot'
import { deriveSuggestions } from '@/lib/opportunities/rules'
import { buildScanEvidence } from '@/lib/scan-evidence'
import type { WorkItem } from '@/lib/work-items/schema'
import type { WorkVerificationObservation } from '@/lib/work-items/verification'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'
import { reportSnapshot } from './report-builder-fixtures'
import type { ReportFindingProvenance } from '@/lib/opportunities/types'

const clientId = '55555555-5555-4555-8555-555555555555'
const reportId = '11111111-1111-4111-8111-111111111111'
const reportVersionId = '22222222-2222-4222-8222-222222222222'
const scanId = '33333333-3333-4333-8333-333333333333'
const taskId = '66666666-6666-4666-8666-666666666666'
const reportCreatedAt = '2026-10-18T09:02:00.000Z'
const scanCreatedAt = '2026-10-18T09:00:00.000Z'

function props(lang: 'en' | 'zh-HK', resumed: boolean, observationMode: 'improved' | 'unchanged' | 'insufficient' = 'improved') {
  const base = reportSnapshot(lang)
  const report = {
    ...base,
    client: { name: lang === 'en' ? 'Synthetic finding brand' : '合成發現品牌', domain: 'example.test' },
    priorityFixes: [{
      key: 'c1_robots',
      title: lang === 'en' ? 'Review crawler access' : '檢查爬蟲存取',
      rationale: lang === 'en'
        ? 'The selected report recorded a robots check failure.'
        : '所選報告記錄了 robots 檢查失敗。',
      expectedImpact: 'high' as const,
      nextStep: lang === 'en'
        ? 'Review robots.txt and report the verified change for later observation.'
        : '核對 robots.txt，並回報已核實修改，留待日後觀察。',
    }],
  }
  const envelope = buildScanEvidence({
    requestedUrl: 'https://example.test/',
    evaluatedUrl: 'https://example.test/',
    industry: 'general_b2b',
    region: 'HK',
    sitemapSource: 'unknown',
    checks: { c1_robots: { assessment: 'fail', collection: 'complete' } },
    observations: [{
      observedAt: scanCreatedAt,
      provenance: 'validated-fetch',
      collection: 'complete',
      target: {
        origin: 'https://example.test', pathRedacted: false, queryRedacted: false,
        fragmentRedacted: false, originNormalized: true,
      },
      httpStatus: 200,
      signals: { mimeType: 'text/plain' },
      check: 'page',
    }],
  })
  const candidate = buildReportFindingCandidates({
    reportId,
    reportVersionId,
    reportVersionNumber: 2,
    reportCreatedAt,
    scanId,
    scanCreatedAt,
    scanResults: { evidence: envelope },
    snapshot: report,
    locale: lang,
  })[0]
  const source = { kind: 'scan-check' as const, scanId, recordedAt: scanCreatedAt, envelope }
  const suggestion = deriveSuggestions(source)[0]
  const loadedReport: Omit<ReportFindingProvenance, 'targetOrigin'> = {
    reportId,
    reportVersionId,
    reportVersionNumber: 2,
    reportCreatedAt,
    findingKey: 'c1_robots',
    findingTitle: candidate.title,
    findingRationale: candidate.rationale,
    findingNextStep: candidate.nextStep,
    expectedImpact: candidate.expectedImpact,
  }
  const notes = resumed
    ? (lang === 'en'
      ? 'Updated robots.txt for the reviewed crawler. Human-reported change only.'
      : '已更新供審閱爬蟲使用的 robots.txt；此為人手回報修改。')
    : ''
  const item: WorkItem = {
    id: taskId,
    clientId,
    status: 'draft',
    title: suggestion.titleKey,
    action: suggestion.actionKey,
    notes,
    locale: lang,
    revision: resumed ? 3 : 1,
    createdAt: '2026-10-18T09:03:00.000Z',
    updatedAt: '2026-10-20T09:00:00.000Z',
    evidenceSnapshot: buildInitialDraftSnapshot(
      suggestion,
      source,
      lang,
      loadedReport,
    ),
    sourceScanIds: [scanId],
  }
  const finding: ReportImprovementFinding = { ...candidate, existingTask: resumed ? item : null }
  const observations: WorkVerificationObservation[] = observationMode === 'insufficient'
    ? [{
        id: '77777777-7777-4777-8777-777777777777',
        source: 'synthetic-incomplete-retest',
        observedAt: null,
        target: 'https://example.test',
        methodCompatible: false,
        issuePresent: null,
      }]
    : [{
        id: '77777777-7777-4777-8777-777777777777',
        source: 'synthetic-retest',
        observedAt: '2026-10-22T09:00:00.000Z',
        target: 'https://example.test',
        methodCompatible: true,
        issuePresent: observationMode === 'unchanged',
      }]
  return {
    lang,
    clientId,
    brandName: report.client.name,
    domain: report.client.domain,
    reportId,
    reportVersionId,
    reportVersionNumber: 2,
    latestVersionNumber: resumed ? 3 : 2,
    locale: lang,
    findingsState: 'ok' as const,
    findings: [finding],
    verificationObservations: observations,
    task: item,
  }
}

function markup(lang: 'en' | 'zh-HK', resumed: boolean, mode: 'improved' | 'unchanged' | 'insufficient' = 'improved') {
  const value = props(lang, resumed, mode)
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={lang} messages={lang === 'en' ? en : zh} timeZone="UTC">
      <ReportImprovementTasks
        clientId={value.clientId}
        brandName={value.brandName}
        domain={value.domain}
        reportId={value.reportId}
        reportVersionId={value.reportVersionId}
        reportVersionNumber={value.reportVersionNumber}
        latestVersionNumber={value.latestVersionNumber}
        locale={value.locale}
        findingsState={value.findingsState}
        findings={value.findings}
        verificationObservations={value.verificationObservations}
      />
    </NextIntlClientProvider>,
  )
}

it.each(['en', 'zh-HK'] as const)('report-task fixture exposes the v2 finding in %s', lang => {
  const html = markup(lang, false)
  expect(html).toContain('c1_robots')
  expect(html).toContain('https://example.test')
  expect(html).toContain(lang === 'en' ? 'Report v2' : '報告第 2 版')
})

afterAll(async () => {
  const dir = process.env.AISO_REPORT_TASK_HTML_DIR
  if (!dir) return
  const css = process.env.AISO_REPORT_TASK_CSS_PATH
  if (!css) throw new Error('AISO_REPORT_TASK_CSS_PATH required')
  const { build } = await import('vite')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'build.css'), readFileSync(css))
  const variants = [
    ['new', false, 'improved'],
    ['resumed-improved', true, 'improved'],
    ['resumed-unchanged', true, 'unchanged'],
    ['resumed-insufficient', true, 'insufficient'],
  ] as const
  for (const lang of ['en', 'zh-HK'] as const) {
    for (const [name, resumed, mode] of variants) {
      const value = props(lang, resumed, mode)
      const data = { props: value, messages: lang === 'en' ? en : zh, lang }
      writeFileSync(join(dir, `${lang}-${name}.html`),
        `<div id="root">${markup(lang, resumed, mode)}</div><script id="fixture-props" type="application/json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`)
    }
  }
  const entry = join(resolve(dir), 'entry.tsx')
  writeFileSync(entry, `
import React,{useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {NextIntlClientProvider} from 'next-intl';
import {ReportImprovementTasks} from '@/components/reports/ReportImprovementTasks';
const d=JSON.parse(document.getElementById('fixture-props').textContent);
function Fixture(){
  useEffect(()=>{window.reportTaskFixtureReady=true},[]);
  return React.createElement(NextIntlClientProvider,{locale:d.lang,messages:d.messages,timeZone:'UTC'},
    React.createElement(ReportImprovementTasks,d.props));
}
createRoot(document.getElementById('root')).render(React.createElement(Fixture));
`)
  await build({
    configFile: false,
    envDir: false,
    oxc: { jsx: { development: false } },
    resolve: { alias: { '@': resolve('.'), 'next/link': resolve('tests/fixtures/fixture-link.tsx') } },
    define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
    build: {
      outDir: resolve(dir), emptyOutDir: false,
      lib: { entry, name: 'ReportTaskFixture', formats: ['iife'], fileName: () => 'fixture.js' },
    },
  })
  unlinkSync(entry)
})
