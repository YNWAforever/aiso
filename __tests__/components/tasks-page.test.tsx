import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTranslator } from 'next-intl'
import { renderWithIntl } from '@/__tests__/helpers/intl'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'

const state = vi.hoisted(() => ({ enabled: false, owned: { id: 'c1' } as { id: string } | null | undefined }))
const owned = vi.hoisted(() => vi.fn())
const list = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn(async () => ({ account_id: 'session-account' })) }))
vi.mock('@/lib/flags', () => ({ isSmeCopilotUiEnabled: () => state.enabled }))
vi.mock('@/lib/work-items/store', () => ({ loadOwnedDraftClient: owned }))
vi.mock('@/lib/tasks/list', () => ({ listTasks: list, TASK_LIMIT: 200 }))
vi.mock('next/navigation', () => ({ notFound: () => { throw Error('NOT_FOUND') } }))
vi.mock('next-intl/server', () => ({ getTranslations: async ({ locale }: { locale: string }) => createTranslator({ locale, messages: locale === 'en' ? en : zh, namespace: 'dashboard.tasks' }) }))
import TasksPage from '@/app/[lang]/dashboard/[clientId]/tasks/page'

beforeEach(() => {
  state.enabled = false
  state.owned = { id: 'c1' }
  owned.mockReset().mockImplementation(async () => { if (state.owned === undefined) throw Error('read failed'); return state.owned })
  list.mockReset().mockResolvedValue([])
})
const page = async (lang: string) => renderWithIntl(await TasksPage({ params: Promise.resolve({ lang, clientId: 'c1' }) }), lang)

describe('owned task page', () => {
  it.each(['en', 'zh-HK'])('passes only the existing SME flag and preserves owned reads in %s', async lang => {
    const copy = (lang === 'en' ? en : zh).dashboard.tasks
    expect(await page(lang)).toContain(copy.subtitle)
    state.enabled = true
    const html = await page(lang)
    expect(html).toContain(copy.sme.title)
    expect(html).toContain(copy.sme.subtitle)
    expect(html).not.toContain(copy.subtitle)
    expect(owned).toHaveBeenCalledWith('session-account', 'c1')
    expect(list).toHaveBeenCalledWith('session-account', 'c1')
  })
  it('keeps foreign ownership 404 and never lists foreign tasks', async () => {
    state.owned = null
    await expect(page('en')).rejects.toThrow('NOT_FOUND')
    expect(list).not.toHaveBeenCalled()
  })
  it('does not turn a failed ownership read into an empty task list', async () => {
    state.owned = undefined
    state.enabled = true
    const html = await page('en')
    expect(html).toContain(en.dashboard.tasks.unavailable)
    expect(html).not.toContain(en.dashboard.tasks.empty_title)
    expect(list).not.toHaveBeenCalled()
  })
})
