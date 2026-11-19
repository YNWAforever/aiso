import { describe, expect, it, vi } from 'vitest'
import {
  aiOverviewConfig,
  buildAiOverviewBody,
  fetchAiOverview,
  namesMentioned,
  parseAiOverview,
} from '@/lib/integrations/dataforseo/ai-overview'

const ok = (items: unknown[]) => ({ tasks: [{ status_code: 20000, result: [{ items }] }] })

describe('parseAiOverview', () => {
  it('reads the overview text and de-duplicated http(s) references', () => {
    const result = parseAiOverview(ok([
      { type: 'organic', title: 'x', url: 'https://x.test' },
      {
        type: 'ai_overview',
        items: [
          { type: 'ai_overview_element', title: '最佳選擇', text: 'AcmeCo 及 RivalCorp 都提供服務。', references: [{ url: 'https://acme.test/a', domain: 'acme.test', title: 'Acme' }] },
        ],
        references: [
          { url: 'https://acme.test/a', domain: 'acme.test' },
          { url: 'javascript:alert(1)' },
          { url: 'https://rival.test/b', domain: 'rival.test', title: 'Rival' },
        ],
      },
    ]))
    expect(result).toEqual({
      status: 'present',
      text: '最佳選擇\nAcmeCo 及 RivalCorp 都提供服務。',
      references: [
        { url: 'https://acme.test/a', domain: 'acme.test', title: null },
        { url: 'https://rival.test/b', domain: 'rival.test', title: 'Rival' },
      ],
    })
  })

  it('prefers the overview markdown when present', () => {
    const result = parseAiOverview(ok([{ type: 'ai_overview', markdown: '**AcmeCo** leads.', items: [{ text: 'ignored' }] }]))
    expect(result).toMatchObject({ status: 'present', text: '**AcmeCo** leads.' })
  })

  it('reports absent, not failed, when Google showed no overview or an empty one', () => {
    expect(parseAiOverview(ok([{ type: 'organic' }]))).toEqual({ status: 'absent' })
    expect(parseAiOverview(ok([{ type: 'ai_overview', items: [] }]))).toEqual({ status: 'absent' })
    expect(parseAiOverview({ tasks: [{ status_code: 20000, result: null }] })).toEqual({ status: 'absent' })
  })

  it('treats a task error or an unexpected shape as a failure, never an answer', () => {
    expect(parseAiOverview({ tasks: [{ status_code: 40501 }] })).toEqual({ status: 'failed', reason: 'task', code: 40501 })
    expect(parseAiOverview(null)).toEqual({ status: 'failed', reason: 'unparseable' })
    expect(parseAiOverview({ tasks: [] })).toEqual({ status: 'failed', reason: 'unparseable' })
  })
})

describe('fetchAiOverview', () => {
  const config = { login: 'l', credential: 'c', locationCode: 2344, languageCode: 'zh-TW' }

  it('sends one task with async AI overviews on, for the Hong Kong market', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(ok([{ type: 'ai_overview', text: 'AcmeCo' }]))))
    const result = await fetchAiOverview('最好的 AI SEO 工具', config, fetchImpl as never)
    expect(result.status).toBe('present')
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual(buildAiOverviewBody('最好的 AI SEO 工具', config))
    expect(JSON.parse(String(init.body)).tasks[0]).toMatchObject({ load_async_ai_overview: true, location_code: 2344, language_code: 'zh-TW' })
  })

  it('makes no request without credentials and reports each failure kind', async () => {
    const fetchImpl = vi.fn()
    expect(await fetchAiOverview('q', null, fetchImpl as never)).toEqual({ status: 'failed', reason: 'credentials_missing' })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(await fetchAiOverview('q', config, (async () => { throw new Error('x') }) as never)).toEqual({ status: 'failed', reason: 'transport' })
    expect(await fetchAiOverview('q', config, (async () => new Response('', { status: 402 })) as never)).toEqual({ status: 'failed', reason: 'http', code: 402 })
  })
})

describe('config and mentions', () => {
  it('needs both credentials and defaults to Hong Kong / zh-TW', () => {
    expect(aiOverviewConfig({ DATAFORSEO_LOGIN: 'l' })).toBeNull()
    expect(aiOverviewConfig({ DATAFORSEO_LOGIN: 'l', DATAFORSEO_PASSWORD: 'c' })).toEqual({ login: 'l', credential: 'c', locationCode: 2344, languageCode: 'zh-TW' })
  })

  it('finds names case-insensitively and ignores blanks', () => {
    expect(namesMentioned('acmeco and RIVALCORP', ['AcmeCo', 'RivalCorp', 'Other', ' '])).toEqual(['AcmeCo', 'RivalCorp'])
  })
})
