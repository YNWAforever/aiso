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
import {
  DomainVerificationPanel,
  type DomainVerificationCopy,
} from '@/components/entities/DomainVerificationPanel'
import { VERIFICATION_PATH, deriveVerificationState } from '@/lib/domain-verification/schema'
import { loadVerification } from '@/lib/domain-verification/store'

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
    'verified',
    'verifyTitle',
    'verifyHow',
    'verifyPathLabel',
    'verifyTokenLabel',
    'verifyCheck',
    'verifyChecking',
    'verifyLastChecked',
    'verifyNoDomain',
    'verifyOutcomeVerified',
    'verifyOutcomeTokenAbsent',
    'verifyOutcomeUnreachable',
    'verifyOutcomeRedirected',
    'verifyOutcomeTooLarge',
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
  // Read-only, and never minted here: a page render must not have the side
  // effect of issuing a token. GET /domain-verification does that when the
  // owner actually opens the panel and asks.
  //
  // Degrades rather than throws. Verification is secondary content on this
  // page — if reading it fails, the owner should still get the editor, which
  // is what they came for. The panel then renders its own empty state rather
  // than the whole route 500ing over a badge.
  let verification: Awaited<ReturnType<typeof loadVerification>> = null
  try {
    verification = await loadVerification(result.client.account_id, result.client.id)
  } catch (error) {
    console.error('[entities] verification lookup failed:', (error as Error)?.message ?? String(error))
  }
  return (
    <>
      <EntityEditor
        clientId={result.client.id}
        brandName={result.client.brand_name}
        initialEntity={result.entity}
        copy={copy}
      />
      <DomainVerificationPanel
        clientId={result.client.id}
        initial={{
          state: deriveVerificationState(verification, verification?.currentDomain ?? null),
          domain: verification?.currentDomain ?? null,
          token: verification?.token || null,
          path: VERIFICATION_PATH,
          lastCheckedAt: verification?.lastCheckedAt ?? null,
          lastOutcome: verification?.lastOutcome ?? null,
        }}
        copy={copy as unknown as DomainVerificationCopy}
      />
    </>
  )
}
