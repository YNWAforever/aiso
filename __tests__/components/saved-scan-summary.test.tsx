import { afterAll, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createHash } from 'node:crypto'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'
import type { Scan } from '@/lib/types'

const state = vi.hoisted(() => ({ lang: 'en' }))
vi.mock('next-intl', () => ({
  useTranslations: (namespace: string) => (key: string) => {
    const messages = (state.lang === 'en' ? en : zh) as unknown as Record<string, Record<string, string>>
    return messages[namespace]?.[key] ?? key
  },
}))
vi.mock('@/components/dashboard/ScanSummary', () => ({ ScanSummary: () => <div>Existing scan checks</div> }))
import { ResultsStep } from '@/components/dashboard/ResultsStep'

const text = '- [c1_robots] 檢查並確認原有爬蟲規則。\n- [c10_headings] 檢視標題層級。\n- [c11_faq] 按實際內容檢查常見問題。'
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const receipt = () => ({ version: 1, id: '11111111-1111-4111-8111-111111111111',
  tokenHash: 'a'.repeat(64), snapshotHash: 'b'.repeat(64),
  input: { domain: 'synthetic.test', score: 14.17, grade: 'F', checks: [] },
  state: 'succeeded', createdAt: '2026-10-16T00:00:00Z', expiresAt: '2099-10-16T00:15:00Z',
  dispatch: { state: 'accepted', httpStatus: 202 }, executionId: 'SYNTHETIC_EXECUTION', workflowId: 'SYNTHETIC_WORKFLOW',
  summary: { text, hash: digest(text), provider: { httpStatus: 200, actualModel: 'qwen/qwen3.5-flash-02-23',
    requestId: 'SYNTHETIC_PROVIDER', promptTokens: 500, completionTokens: 120, costUsd: 0.0000637 } } })
function render(value: unknown) {
  const scan = { id: 'synthetic-scan', score: 14.17, grade: 'F', domain: 'synthetic.test', results: { _n8n: value } } as unknown as Scan
  return renderToStaticMarkup(<ResultsStep scan={scan} lang={state.lang} clientId="synthetic-client" />)
}
for (const lang of ['en', 'zh-HK']) {
  it(`shows saved summary on the existing results route and a second render (${lang})`, () => {
    state.lang = lang
    const saved = receipt()
    const first = render(saved), reloaded = render(JSON.parse(JSON.stringify(saved)))
    expect(first).toContain('檢查並確認原有爬蟲規則')
    expect(first).toContain('Existing scan checks')
    expect(reloaded).toEqual(first)
    expect(first).not.toContain('SYNTHETIC_PROVIDER')
    expect(first).not.toContain('tokenHash')
    expect(first).not.toContain('a'.repeat(64))
  })
  it(`does not add paid actions or network calls when results are rendered repeatedly (${lang})`, () => {
    state.lang = lang
    const fetch = vi.fn(() => { throw new Error('NETWORK_FORBIDDEN') })
    vi.stubGlobal('fetch', fetch)
    const first = render(receipt()), second = render(receipt())
    expect(first).toEqual(second)
    expect(first).not.toContain('<button')
    expect(fetch).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
  it(`does not expose a stale or malformed summary as success (${lang})`, () => {
    state.lang = lang
    for (const bad of [
      { ...receipt(), summary: { ...receipt().summary, text: '' } },
      { ...receipt(), summary: { ...receipt().summary, hash: 'c'.repeat(64) } },
      { ...receipt(), summary: { ...receipt().summary, provider: { ...receipt().summary.provider, httpStatus: 403 } } },
    ]) {
      const html = render(bad)
      expect(html).not.toContain('檢查並確認原有爬蟲規則')
      expect(html).not.toContain(lang === 'en' ? 'Summary saved' : '摘要已保存')
      expect(html).toContain(lang === 'en' ? 'Summary unavailable' : '未能提供摘要')
    }
  })
  for (const status of ['queued', 'running', 'failed']) {
    it(`shows ${status} without success copy or retained partial text (${lang})`, () => {
      state.lang = lang
      const html = render({ ...receipt(), state: status })
      expect(html).not.toContain('檢查並確認原有爬蟲規則')
      expect(html).not.toContain(lang === 'en' ? 'Summary saved' : '摘要已保存')
      expect(html).toContain(lang === 'en' ? 'Saved scan summary' : '掃描摘要')
    })
  }
  it(`shows an expired in-flight or uncertain dispatch as unconfirmed (${lang})`, () => {
    state.lang = lang
    for (const value of [
      { ...receipt(), state: 'running', expiresAt: '2000-01-01T00:00:00Z' },
      { ...receipt(), state: 'queued', dispatch: { state: 'outcome_unknown', httpStatus: null } },
    ]) {
      const html = render(value)
      expect(html).toContain(lang === 'en' ? 'Outcome unconfirmed' : '結果尚未確認')
      expect(html).not.toContain('檢查並確認原有爬蟲規則')
    }
  })
  it(`keeps a terminal saved summary visible after capability expiry (${lang})`, () => {
    state.lang = lang
    expect(render({ ...receipt(), expiresAt: '2000-01-01T00:00:00Z' })).toContain('檢查並確認原有爬蟲規則')
  })
  it(`escapes provider text and hides absent receipts (${lang})`, () => {
    state.lang = lang
    const unsafe = '<script>alert("untrusted")</script>'
    const value = { ...receipt(), summary: { ...receipt().summary, text: unsafe, hash: digest(unsafe) } }
    expect(render(value)).not.toContain('<script>')
    expect(render(value)).toContain('&lt;script&gt;')
    expect(render(undefined)).not.toContain(lang === 'en' ? 'Saved scan summary' : '掃描摘要')
  })
}

afterAll(async () => {
  const directory = process.env.AISO_SUMMARY_FIXTURE_DIR
  if (!directory) return
  const { mkdirSync, writeFileSync } = await import('node:fs')
  mkdirSync(directory, { recursive: true })
  const cases = {
    saved: receipt(),
    failed: { ...receipt(), state: 'failed', error: 'PROVIDER_FAILED' },
    timeout: { ...receipt(), state: 'running', expiresAt: '2000-01-01T00:00:00Z' },
    empty: { ...receipt(), summary: { ...receipt().summary, text: '' } },
    processing: { ...receipt(), state: 'running' },
    malformed: { ...receipt(), summary: { ...receipt().summary, provider: { ...receipt().summary.provider, httpStatus: 403 } } },
  }
  for (const lang of ['en', 'zh-HK']) for (const [name, value] of Object.entries(cases)) {
    state.lang = lang
    const banner = lang === 'en' ? 'Offline fixture: synthetic data, no provider call.' : '離線測試：合成資料，未有模型呼叫。'
    writeFileSync(directory + '/' + lang + '-' + name + '.html', '<!doctype html><html lang="' + lang + '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline saved-summary fixture</title><style>body{font:16px/1.6 system-ui,sans-serif;background:#f4f7fa;color:#17202a;margin:24px auto;padding:0 16px;max-width:820px}section{border:1px solid #cbd5e1;border-radius:12px;background:white;padding:20px;margin:20px 0}section>div{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px}h2{font-size:18px;margin:0}p{overflow-wrap:anywhere}section>p:first-of-type{white-space:pre-line}.text-dash-success{color:#166534}[role=status]{font-size:13px}a{display:inline-block;margin:8px 18px 8px 0;color:#1d4ed8}</style></head><body><p>' + banner + '</p>' + render(value) + '</body></html>')
  }
})
