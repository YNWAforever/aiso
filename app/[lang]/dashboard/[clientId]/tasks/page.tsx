import { getTranslations } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { requireAuth } from '@/lib/auth'
import { loadOwnedDraftClient } from '@/lib/work-items/store'
import { listTasks, TASK_LIMIT, type TaskRow } from '@/lib/tasks/list'
import { PageHeader } from '@/components/ui/page-header'
import { TaskList } from '@/components/tasks/TaskList'

/**
 * Every work item for this brand as one task list: approvals, change-sets and
 * delivery folded into a single status. Gated like its siblings: the layout and
 * this page both require a session, the brand must belong to the account
 * (404 otherwise), and the list query filters by the session's account.
 */
export default async function TasksPage({ params }: { params: Promise<{ lang: string; clientId: string }> }) {
  const { lang: requestedLang, clientId } = await params
  const lang = requestedLang === 'zh-HK' ? 'zh-HK' : 'en'
  const profile = await requireAuth(lang)
  const t = await getTranslations({ locale: lang, namespace: 'dashboard.tasks' })

  // A failed ownership lookup is "unavailable", not "not yours".
  let owned: { id: string } | null | undefined
  try { owned = await loadOwnedDraftClient(profile.account_id, clientId) } catch { owned = undefined }
  if (owned === null) notFound()

  let tasks: TaskRow[] | null = null
  if (owned) {
    try { tasks = await listTasks(profile.account_id, clientId) } catch (error) {
      console.error('[tasks] list failed:', error)
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8 sm:px-6">
      <PageHeader title={t('title')} description={t('subtitle')} />
      <TaskList
        lang={lang}
        clientId={clientId}
        tasks={tasks}
        limited={tasks !== null && tasks.length >= TASK_LIMIT}
      />
    </main>
  )
}
