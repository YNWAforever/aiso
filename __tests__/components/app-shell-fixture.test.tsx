import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ReactElement } from 'react'
import { afterAll, describe, expect, it, vi } from 'vitest'

const nav = vi.hoisted(() => ({
  params: { lang: 'en' } as { lang: string; clientId?: string },
  step: null as string | null,
  pathname: '/en/dashboard',
}))
vi.mock('next/navigation', () => ({
  useParams: () => nav.params,
  useSearchParams: () => new URLSearchParams(nav.step ? { step: nav.step } : {}),
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({ db: () => vi.fn() }))

import { DashboardSidebar } from '@/components/dashboard/DashboardSidebar'
import { TopBar } from '@/components/dashboard/shell/TopBar'
import { TaskList } from '@/components/tasks/TaskList'
import { PageHeader } from '@/components/ui/page-header'
import { MonitorSignals } from '@/components/pulse/MonitorSignals'
import { monitorView } from '../../tests/fixtures/monitor'
import type { TaskRow } from '@/lib/tasks/status'
import { resolveCommercialEntitlement } from '@/lib/tier'
import { renderWithIntl } from '@/__tests__/helpers/intl'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'

// Offline presentation fixtures for tests/e2e/app-shell.spec.ts: the real
// sidebar, top bar and task list, server-rendered with the real catalogue.
// Never an authenticated route bypass.

const CLIENT = '11111111-1111-4111-8111-111111111111'
const entitlement = resolveCommercialEntitlement({
  plan: 'pro', status: 'active', stripe_subscription_id: 'sub_fixture',
  trial_ends_at: null, override_plan: null, override_expires_at: null,
} as never)
const brands = [
  { id: CLIENT, name: 'Example Brand', domain: 'example.com' },
  { id: '22222222-2222-4222-8222-222222222222', name: 'Second Brand', domain: 'second.example' },
]
const tasks: TaskRow[] = [
  { id: 'a1', title: 'Publish an llms.txt file', checkKey: 'c2', status: 'in_review', versionNumber: 2, updatedAt: '2026-10-20T08:00:00.000Z' },
  { id: 'a2', title: 'Add FAQ structured data to the pricing page', checkKey: 'c8', status: 'changes_requested', versionNumber: 1, updatedAt: '2026-10-19T08:00:00.000Z' },
  { id: 'a3', title: 'Name the founders on the About page', checkKey: null, status: 'approved', versionNumber: 3, updatedAt: '2026-10-18T08:00:00.000Z' },
  { id: 'a4', title: 'Allow AI crawlers in robots.txt', checkKey: 'c1', status: 'delivered', versionNumber: 1, updatedAt: '2026-10-17T08:00:00.000Z' },
  { id: 'a5', title: 'Answer the top buyer question on the home page', checkKey: null, status: 'draft', versionNumber: null, updatedAt: '2026-10-16T08:00:00.000Z' },
]

function shell(lang: string, pathname: string, clientId: string | undefined, content: ReactElement) {
  nav.params = clientId ? { lang, clientId } : { lang }
  nav.pathname = pathname
  nav.step = null
  return renderWithIntl(
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
        <DashboardSidebar profile={{ display_name: 'Fixture Owner' }} entitlement={entitlement} />
        <div className="flex w-full min-w-0 flex-1 flex-col overflow-auto">
          <TopBar lang={lang} brands={brands} unreadCount={2} features={entitlement.features} />
          {content}
        </div>
      </div>
    </div>,
    lang,
  )
}

function tasksPage(lang: string, list: TaskRow[] | null) {
  const copy = (lang === 'en' ? en : zh).dashboard.tasks
  return shell(lang, `/${lang}/dashboard/${CLIENT}/tasks`, CLIENT,
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8 sm:px-6">
      <PageHeader title={copy.title} description={copy.subtitle} />
      <TaskList lang={lang} clientId={CLIENT} tasks={list} limited={false} />
    </main>)
}

const STATES = {
  tasks: (lang: string) => tasksPage(lang, tasks),
  'tasks-empty': (lang: string) => tasksPage(lang, []),
  'tasks-unavailable': (lang: string) => tasksPage(lang, null),
  monitor: (lang: string) => shell(lang, `/${lang}/dashboard/${CLIENT}`, CLIENT,
    <main className="mx-auto w-full min-w-0 max-w-4xl px-4 py-8 sm:px-6"><h1 className="mb-5 text-2xl font-bold">{(lang === 'en' ? en : zh).dashboard.step_monitor_title}</h1><MonitorSignals view={monitorView('2026-09-28')} lang={lang} now={new Date('2026-10-23T00:00:00Z')} /></main>),
  portfolio: (lang: string) => shell(lang, `/${lang}/dashboard`, undefined, <main className="px-4 py-8"><h1>{(lang === 'en' ? en : zh).dashboard.shell.brands}</h1></main>),
} as const

describe('app shell fixtures', () => {
  it.each(['en', 'zh-HK'])('renders the shell around the task list in %s', lang => {
    const html = STATES.tasks(lang)
    const copy = (lang === 'en' ? en : zh).dashboard
    expect(html).toContain(copy.nav_scan_fix.replace('&', '&amp;'))
    expect(html).toContain(copy.tasks.status.delivered)
    expect(html).toContain('aria-label="Breadcrumb"'.replace('Breadcrumb', (lang === 'en' ? en : zh).ui.breadcrumbs))
  })
})

afterAll(() => {
  const directory = process.env.AISO_SHELL_HTML_DIR
  if (!directory) return
  mkdirSync(directory, { recursive: true })
  for (const lang of ['en', 'zh-HK']) {
    for (const [state, render] of Object.entries(STATES)) writeFileSync(join(directory, `${lang}-${state}.html`), render(lang), 'utf8')
  }
})
