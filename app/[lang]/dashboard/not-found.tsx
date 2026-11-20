import Link from 'next/link'
import { getLocale, getTranslations } from 'next-intl/server'
import { EmptyState } from '@/components/ui/empty-state'

export default async function DashboardNotFound() {
  const [locale, t, states] = await Promise.all([getLocale(), getTranslations('notFound'), getTranslations('dashboard.states')])
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
      <EmptyState illustration="error" title={t('title')} description={t('workspace_body')}
        action={<Link href={`/${locale}/dashboard`} className="inline-flex min-h-11 items-center rounded-lg bg-primary px-4 font-semibold text-primary-foreground">{states('backToBrands')}</Link>} />
    </main>
  )
}
