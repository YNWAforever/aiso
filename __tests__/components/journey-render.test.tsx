import { afterAll, describe, expect, it, vi } from 'vitest'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { build } from 'vite'
import { renderToString, renderToStaticMarkup } from 'react-dom/server'
import type { ComponentPropsWithoutRef } from 'react'
import { createTranslator, NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'
import type { WorkspaceHome } from '@/lib/view-models/workspace-home'
import { taskStatus } from '@/lib/tasks/status'
import { JourneyFixture, journeyDestination, type JourneyFixtureProps } from '../sme-journey/JourneyFixture'
import { JourneyMemory } from '../sme-journey/transport'
import { createJourneyScenario } from '../sme-journey/scenario.node'
import type { JourneyActor, JourneyScenario, JourneyStage } from '../sme-journey/types'

const copy = vi.hoisted(() => ({ lang: 'en' as 'en' | 'zh-HK' }))
vi.mock('server-only', () => ({}))
vi.mock('next-intl/server', () => ({ getTranslations: async (namespace: string) => {
  const source = copy.lang === 'en' ? en : zh
  const messages: AbstractIntlMessages = { today: source.today, workspaceHome: source.workspaceHome, runProgress: source.runProgress }
  return createTranslator({ locale: copy.lang, messages, namespace })
} }))
vi.mock('next/link', () => ({ default: ({ href, prefetch, children, ...props }: ComponentPropsWithoutRef<'a'> & { href: string; prefetch?: boolean }) => { void prefetch; return <a href={href} {...props}>{children}</a> } }))
vi.mock('@/components/dashboard/today/TodayAsk', () => ({ TodayAsk: () => null }))
vi.mock('@/components/reports/MonthlyReportEntry', () => ({ MonthlyReportEntry: () => null }))
vi.mock('@/components/dashboard/overview/OverviewStats', () => ({ OverviewStats: () => null }))
vi.mock('@/components/dashboard/overview/ScoreTrend', () => ({ ScoreTrend: () => null }))
vi.mock('@/components/PillarScoreCards', () => ({ PillarScoreCards: () => null }))
vi.mock('@/components/pulse/RunProgress', () => ({ RunProgress: () => null }))
import { BrandToday } from '@/components/dashboard/today/BrandToday'

const stages: JourneyStage[] = ['draft', 'pending', 'approved', 'delivered']
const messages = (lang: JourneyScenario['lang']) => lang === 'en' ? en : zh
const render = (props: JourneyFixtureProps) => renderToString(<NextIntlClientProvider locale={props.scenario.lang} messages={messages(props.scenario.lang)} timeZone="UTC"><JourneyFixture {...props} /></NextIntlClientProvider>)
const sha = (value: string) => createHash('sha256').update(value).digest('hex')
const safeJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c')

async function todayStates(scenario: JourneyScenario): Promise<Record<JourneyStage, string>> {
  const result = {} as Record<JourneyStage, string>
  copy.lang = scenario.lang
  for (const stage of stages) {
    const draft = stage === 'draft' ? scenario.draft : scenario.canonicalDrafts[1]
    const workspace: WorkspaceHome = {
      client: { id: scenario.ids.clientId, brand_name: scenario.brandName, domain: 'example.test', industry: 'retail_ecommerce', status: 'active' },
      priorities: { state: 'ready', priorities: [], primaryAction: null, needsEvidence: [], observedFindings: 0 },
      nextStep: { kind: 'review_opportunity', labelKey: 'opportunities', href: `/__locale__/dashboard/${scenario.ids.clientId}/opportunities` },
      savedWork: { status: 'ok', data: [{ id: draft.id, title: draft.title, checkKey: scenario.baseline.source.checkKey,
        status: taskStatus({ versionId: stage === 'draft' ? null : scenario.ids.versionId, decision: stage === 'approved' || stage === 'delivered' ? 'approved' : null, delivered: stage === 'delivered' }),
        versionNumber: stage === 'draft' ? null : 1, updatedAt: scenario.clock }] },
      siteHealth: { state: 'empty', data: null, observedAt: null, freshness: 'unknown' },
      history: { state: 'empty', data: null, observedAt: null, freshness: 'unknown' },
      visibility: { state: 'empty', data: null, observedAt: null, freshness: 'unknown' },
      recommendations: { state: 'empty', data: null, observedAt: null, freshness: 'unknown', generated: true },
    }
    result[stage] = renderToStaticMarkup(await BrandToday({ workspace, lang: scenario.lang, chatEnabled: false, clientReportsOnline: false }))
  }
  return result
}

function reviewProps(scenario: JourneyScenario, actor: JourneyActor, stage: JourneyStage): JourneyFixtureProps {
  // R1/R2 are alternative first submissions, not version-number history.
  const memory = new JourneyMemory({ ...scenario, draft: scenario.canonicalDrafts[1] })
  const base = `/api/clients/${scenario.ids.clientId}/work-items/${scenario.ids.itemId}/versions`
  if (stage !== 'draft') {
    expect(memory.request({ actor: 'owner', method: 'POST', path: base, body: { expectedRevision: scenario.canonicalDrafts[1].revision } }).status).toBeLessThan(300)
    if (stage === 'approved' || stage === 'delivered') expect(memory.request({ actor: 'reviewer', method: 'POST', path: `${base}/${scenario.ids.versionId}/decision`, body: {
      decision: 'approved', reason: scenario.lang === 'en' ? 'Reviewed the saved sample evidence.' : '已查看儲存嘅示例證據。', requestId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    } }).status).toBeLessThan(300)
    if (stage === 'delivered') expect(memory.request({ actor: 'owner', method: 'POST', path: `${base}/${scenario.ids.versionId}/delivery`, body: {
      contentHash: memory.versions[0].contentHash, destination: scenario.lang === 'en' ? 'Sample website' : '示例網站', deliveredAt: scenario.deliveredAt,
      note: scenario.lang === 'en' ? 'Manual delivery declared in the controlled sample.' : '喺受控示例中申報手動交付。', requestId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    } }).status).toBeLessThan(300)
  }
  return { scenario, mode: 'document', view: 'review', actor, stage, versionProps: memory.versionProps(actor) }
}

async function packets(scenario: JourneyScenario) {
  const today = await todayStates(scenario)
  return {
    today: { scenario, mode: 'document', view: 'today', actor: 'owner', todayHtml: today.draft } satisfies JourneyFixtureProps,
    draft: { scenario, mode: 'document', view: 'draft', actor: 'owner' } satisfies JourneyFixtureProps,
    'owner-prepare': reviewProps(scenario, 'owner', 'draft'),
    'owner-pending': reviewProps(scenario, 'owner', 'pending'),
    'reviewer-pending': reviewProps(scenario, 'reviewer', 'pending'),
    'owner-approved': reviewProps(scenario, 'owner', 'approved'),
    'owner-delivered': reviewProps(scenario, 'owner', 'delivered'),
    preview: { scenario, mode: 'standalone', view: 'today', todayStates: today } satisfies JourneyFixtureProps,
  }
}

describe.each(['en', 'zh-HK'] as const)('controlled journey rendering %s', lang => {
  it('accepts only exact sample destinations and never discards an unsupported query', () => {
    const scenario = createJourneyScenario(lang), base = `/${lang}/dashboard/${scenario.ids.clientId}`
    expect(journeyDestination(base, scenario)).toBe('today')
    expect(journeyDestination(`${base}/opportunities`, scenario)).toBe('draft')
    expect(journeyDestination(`${base}/opportunities?draft=${scenario.ids.itemId}`, scenario)).toBe('draft')
    expect(journeyDestination(`${base}/tasks`, scenario)).toBe('draft')
    expect(journeyDestination(`${base}/work-items/${scenario.ids.itemId}/versions`, scenario)).toBe('review')
    for (const href of [
      `${base}?step=monitor`, `${base}?step=results`, `${base}?step=scan`, `${base}#unrelated`,
      `${base}/opportunities?draft=another-item`, `${base}/opportunities?draft=${scenario.ids.itemId}&extra=1`,
      `${base}/opportunities?draft=${scenario.ids.itemId}&draft=${scenario.ids.itemId}`,
      `${base}/tasks?status=approved`, `${base}/work-items/${scenario.ids.itemId}/versions?other=1`,
      `https://journey.fixture${base}`, `//example.test${base}`,
    ]) expect(journeyDestination(href, scenario)).toBeNull()
  })
  it('renders actual Today and draft runtime with friendly sample data and exact native destinations', async () => {
    const scenario = createJourneyScenario(lang), all = await packets(scenario)
    expect(render(all.today)).toContain(scenario.brandName)
    expect(render(all.today)).toContain(`/${lang}/dashboard/${scenario.ids.clientId}/opportunities?draft=${scenario.ids.itemId}`)
    expect(render(all.draft)).toContain(messages(lang).opportunities.sme.title)
    expect(render(all.today)).not.toMatch(/<script>|alert\(1\)|verified_live/)
  })
  it('starts the edited canonical draft with no frozen version and preserves actual actor-specific review gates', async () => {
    const all = await packets(createJourneyScenario(lang))
    expect(all['owner-prepare'].versionProps?.initialVersion).toBeNull()
    expect(all['owner-prepare'].versionProps?.initial?.versions).toEqual([])
    expect(render(all['owner-prepare'])).toContain(messages(lang).changeSets.submitVersion)
    expect(all['owner-pending'].versionProps?.initialVersion?.capabilities.canDecide).toBe(false)
    expect(all['reviewer-pending'].versionProps?.initialVersion?.capabilities.canDecide).toBe(true)
    expect(render(all['owner-pending'])).not.toContain(`>${messages(lang).changeSets.recordDecision}</button>`)
    expect(render(all['reviewer-pending'])).toContain(messages(lang).changeSets.recordDecision)
    expect(render(all['owner-approved'])).toContain(messages(lang).delivery.sme.title)
    expect(render(all['owner-delivered'])).toContain(messages(lang).outcomes.title)
  })
  it('renders the standalone sample honestly with exact supported alternative draft text', async () => {
    const scenario = createJourneyScenario(lang), all = await packets(scenario)
    const html = render(all.preview)
    expect(html).toContain(scenario.canonicalDrafts[1].title)
    expect(html).toContain(scenario.deliveredAt)
    expect(html).toContain(lang === 'en' ? 'Switching a demo actor is not signing in.' : '切換示例角色並唔代表登入。')
    expect(html).not.toContain('<script>')
  })
})

afterAll(async () => {
  const directory = process.env.C9J_HTML_DIR
  if (!directory) return
  const cssPath = process.env.C9J_CSS_PATH
  if (!cssPath) throw new Error('C9J_CSS_PATH must identify actual final build CSS')
  const css = readFileSync(cssPath, 'utf8')
  mkdirSync(directory, { recursive: true })
  const result = await build({
    configFile: false, envDir: false, logLevel: 'warn', oxc: { jsx: { development: false } },
    plugins: [{ name: 'controlled-journey-entry', resolveId(id) { if (id === 'virtual:journey-entry') return '\0journey-entry' }, load(id) {
      if (id !== '\0journey-entry') return
      return `import React,{useEffect} from 'react';import{hydrateRoot}from'react-dom/client';import{NextIntlClientProvider}from'next-intl';import{JourneyFixture}from'@/__tests__/sme-journey/JourneyFixture';const d=JSON.parse(document.getElementById('fixture-props').textContent);function Root(){useEffect(()=>{window.c9cFixtureReady=true;window.journeyFixtureReady=true},[]);return React.createElement(NextIntlClientProvider,{locale:d.props.scenario.lang,messages:d.messages,timeZone:'UTC'},React.createElement(JourneyFixture,d.props))}hydrateRoot(document.getElementById('root'),React.createElement(Root));`
    } }],
    resolve: { alias: { '@': resolve('.') } }, define: { 'process.env.NODE_ENV': '"production"' },
    build: { write: false, modulePreload: false, rollupOptions: { input: 'virtual:journey-entry', output: { format: 'iife', name: 'JourneySample', entryFileNames: 'fixture.js', inlineDynamicImports: true } } },
  })
  const outputs = Array.isArray(result) ? result : [result]
  const chunk = outputs.flatMap(output => 'output' in output ? output.output : []).find(output => output.type === 'chunk')
  if (!chunk || chunk.type !== 'chunk') throw new Error('Actual journey runtime bundle was not generated')
  const forbiddenClientModules = chunk.moduleIds.filter(id => /(?:node:|server-only|\/lib\/db\.|\/scenario\.node\.)/.test(id.replaceAll('\\', '/')))
  if (forbiddenClientModules.length) throw new Error(`Server modules reached the client bundle: ${forbiddenClientModules.join(', ')}`)
  if (chunk.moduleIds.some(id => id.includes('jsx-dev-runtime'))) throw new Error('Development JSX runtime reached the production client bundle')
  const bundle = chunk.code
  writeFileSync(join(directory, 'fixture.js'), bundle)
  writeFileSync(join(directory, 'build.css'), css)
  // Playwright's Node process calls the actual freezer on the actual saved draft.
  // Keep the empty sentinel in this Node build; the client build above has no shim.
  const nodeResult = await build({
    configFile: false, envDir: false, logLevel: 'warn', oxc: { jsx: { development: false } },
    plugins: [{ name: 'node-fixture-guards', resolveId(id) {
      if (id === 'server-only') return '\0journey-node-server-only'
      if (id === 'virtual:journey-no-live-db') return '\0journey-no-live-db'
    }, load(id) {
      if (id === '\0journey-node-server-only') return 'export {}'
      if (id === '\0journey-no-live-db') return "export function db(){throw Error('NO_LIVE_DB_IN_JOURNEY')}"
    } }],
    resolve: { alias: [{ find: '@/lib/db', replacement: 'virtual:journey-no-live-db' }, { find: '@', replacement: resolve('.') }] }, ssr: { noExternal: true, external: ['node:crypto'] },
    build: { write: false, target: 'node24', ssr: resolve('__tests__/sme-journey/scenario.node.ts'),
      rollupOptions: { external: ['node:crypto'], output: { format: 'cjs', entryFileNames: 'scenario-freezer.cjs' } } },
  })
  const nodeOutputs = Array.isArray(nodeResult) ? nodeResult : [nodeResult]
  const nodeChunk = nodeOutputs.flatMap(output => 'output' in output ? output.output : []).find(output => output.type === 'chunk')
  if (!nodeChunk || nodeChunk.type !== 'chunk') throw new Error('Actual Node scenario freezer bundle was not generated')
  const nodeBundlePath = join(resolve(directory), 'scenario-freezer.cjs')
  writeFileSync(nodeBundlePath, nodeChunk.code)
  const nodeFactory = createRequire(import.meta.url)(nodeBundlePath) as { createJourneyScenario: typeof createJourneyScenario; freezeJourneyDraft: (draft: JourneyScenario['draft']) => JourneyScenario['canonicalVersions'][number] }
  const artifacts: Record<string, string> = { 'fixture.js': sha(bundle), 'scenario-freezer.cjs': sha(nodeChunk.code), 'build.css': sha(css) }
  for (const lang of ['en', 'zh-HK'] as const) {
    const scenario = createJourneyScenario(lang), all = await packets(scenario)
    expect(nodeFactory.createJourneyScenario(lang)).toEqual(scenario)
    expect(nodeFactory.freezeJourneyDraft(scenario.canonicalDrafts[1])).toEqual(scenario.canonicalVersions[1])
    const scenarioJson = safeJson(scenario)
    writeFileSync(join(directory, `${lang}-scenario.json`), scenarioJson)
    artifacts[`${lang}-scenario.json`] = sha(scenarioJson)
    for (const [name, props] of Object.entries(all)) {
      const payload = `<div id="root">${render(props)}</div><script id="fixture-props" type="application/json">${safeJson({ props, messages: messages(lang) })}</script>`
      const html = name !== 'preview' ? payload : `<!doctype html><html lang="${lang}" class="light" style="--font-inter:Arial"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'"><title>${lang === 'en' ? 'Controlled SME sample' : '受控中小企示例'}</title><style>${css.replace(/<\/style/gi, '<\\/style')}</style></head><body>${payload}<script>${bundle.replace(/<\/script/gi, '<\\/script')}</script></body></html>`
      writeFileSync(join(directory, `${lang}-${name}.html`), html)
      artifacts[`${lang}-${name}.html`] = sha(html)
    }
  }
  writeFileSync(join(directory, 'manifest.json'), JSON.stringify({ schemaVersion: 1, artifacts, locales: ['en', 'zh-HK'],
    bounds: ['Actual client components hydrate with local sample transport.', 'Today is actual server-rendered markup; Next Link is rendered as an ordinary anchor.', 'The sample supplies local Arial for the omitted next/font layout variable; CJK uses the existing platform fallback stack. Exact Inter typography is not established.', 'No real auth, role grants, provider calls, website edits, database persistence or SME acceptance are established.', 'Only exact Node-frozen canonical saved revisions may be prepared offline.', 'Package downloads and provider actions are not supported or verified by this sample.'],
    clientGraph: { checked: true, forbidden: ['node:*', 'server-only', 'lib/db', 'scenario.node'] },
    nodeFactory: { runtime: 'node24', crypto: 'real node:crypto', database: 'throwing fixture guard', serverOnlySentinel: 'empty in this Node build' },
    omittedTodayComponents: ['TodayAsk', 'MonthlyReportEntry', 'OverviewStats', 'ScoreTrend', 'PillarScoreCards', 'RunProgress'],
  }, null, 2))
})
