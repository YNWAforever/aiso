import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({ db: () => vi.fn() }))

import { TaskList } from '@/components/tasks/TaskList'
import type { TaskRow } from '@/lib/tasks/list'
import { renderWithIntl } from '@/__tests__/helpers/intl'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'

const task = (id: string, status: TaskRow['status'], versionNumber: number | null = 1): TaskRow =>
  ({ id, title: `Task ${id}`, checkKey: null, status, versionNumber, updatedAt: '2026-10-01T00:00:00.000Z' })

describe('TaskList', () => {
  it.each(['en', 'zh-HK'] as const)('shows one status chip per task and filters with counts in %s', lang => {
    const copy = (lang === 'en' ? en : zh).dashboard.tasks
    const html = renderWithIntl(<TaskList lang={lang} clientId="c1" limited={false} tasks={[task('a', 'draft', null), task('b', 'in_review'), task('c', 'delivered')]} />, lang)

    expect(html).toContain('aria-pressed="true"')
    for (const status of ['draft', 'in_review', 'delivered'] as const) expect(html).toContain(copy.status[status])
    // Filters only for statuses that have tasks.
    expect(html).not.toContain(copy.status.changes_requested)
    expect(html).toContain(copy.not_submitted)
  })

  it('opens a draft in Opportunities and a submitted task on its review page', () => {
    const html = renderWithIntl(<TaskList lang="en" clientId="c1" limited={false} tasks={[task('a', 'draft', null), task('b', 'approved', 2)]} />)
    expect(html).toContain('href="/en/dashboard/c1/opportunities"')
    expect(html).toContain('href="/en/dashboard/c1/work-items/b/versions"')
  })

  it('says the list is unavailable rather than empty when it could not be read', () => {
    const html = renderWithIntl(<TaskList lang="en" clientId="c1" limited={false} tasks={null} />)
    expect(html).toContain(en.dashboard.tasks.unavailable)
    expect(html).not.toContain(en.dashboard.tasks.empty_title)
  })

  it('offers Opportunities when there are no tasks yet', () => {
    const html = renderWithIntl(<TaskList lang="en" clientId="c1" limited={false} tasks={[]} />)
    expect(html).toContain(en.dashboard.tasks.empty_title)
    expect(html).toContain('href="/en/dashboard/c1/opportunities"')
  })
})
