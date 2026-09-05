import { getTranslations } from 'next-intl/server'
import { notFound, redirect } from 'next/navigation'
import {
  EntityEditor,
  type EntityCopy,
} from '@/components/entities/EntityEditor'
import {
  loadAuthenticatedEntityPage,
  EntityServiceError,
} from '@/lib/entities/service'

export default async function EntitiesPage({
  params,
}: {
  params: Promise<{ lang: string; clientId: string }>
}) {
  const { lang: requestedLang, clientId } = await params
  const lang = requestedLang === 'zh-HK' ? 'zh-HK' : 'en'
  const href = `/${lang}/dashboard/${encodeURIComponent(clientId)}/entities`
  const t = await getTranslations({ locale: lang, namespace: 'entities' })
  let result
  try {
    result = await loadAuthenticatedEntityPage(clientId)
  } catch (error) {
    if (error instanceof EntityServiceError) {
      if (error.code === 'UNAUTHENTICATED')
        redirect(`/${lang}/auth/login?next=${encodeURIComponent(href)}`)
      if (
        error.code === 'INVALID_ENTITY_INPUT' ||
        error.code === 'CLIENT_NOT_FOUND'
      )
        notFound()
    }
    return (
      <main className="mx-auto w-full max-w-3xl space-y-4 p-4 md:p-8">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p role="alert">{t('loadError')}</p>
        <a
          href={href}
          className="inline-flex min-h-11 items-center rounded-lg border border-border px-4 text-primary underline"
        >
          {t('retry')}
        </a>
      </main>
    )
  }
  const keys = [
    'title',
    'description',
    'privateLabel',
    'unverified',
    'unsaved',
    'saved',
    'displayName',
    'aliases',
    'aliasesHelp',
    'save',
    'saving',
    'reload',
    'reloading',
    'conflict',
    'saveError',
    'loadError',
    'invalid',
    'unauthenticated',
    'unavailable',
  ] as const
  const copy = Object.fromEntries(
    keys.map((key) => [key, t(key)]),
  ) as EntityCopy
  return (
    <EntityEditor
      clientId={result.client.id}
      brandName={result.client.brand_name}
      initialEntity={result.entity}
      copy={copy}
    />
  )
}
