import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { LockKeyhole } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { PromptBankEditor } from '@/components/pulse/PromptBankEditor'
import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import { MAX_PROMPTS } from '@/lib/pulse/limits'
import { resolveCommercialEntitlement } from '@/lib/tier'
import type { PromptBankItem } from '@/lib/types'

export const dynamic = 'force-dynamic'

/**
 * The question bank — the only place a brand's monitored questions can be
 * changed. Until this page existed the bank was written once at onboarding and
 * frozen: `is_active` is what the weekly Pulse run filters on, so whatever that
 * one LLM call produced was what got scanned, indefinitely.
 *
 * This replaces a redirect to /{lang}/pulse/{clientId}, which resolves to an
 * "unavailable" placeholder — so the fully-built editor was unreachable.
 *
 * Deliberately renders PromptBankEditor rather than QuestionBankSection: the
 * latter wraps it with a "Suggest more" button wired to
 * /api/pulse/suggest-questions, which is still fenced, and its accept handler
 * updates its own copy of the list that the editor never re-reads.
 */
export default async function PromptsPage({
  params,
}: {
  params: Promise<{ lang: string; clientId: string }>
}) {
  const { lang, clientId } = await params
  // Normalised before requireAuth, which builds a redirect URL from it. The
  // layout passes lang raw; the reports page normalises, and this follows it.
  const locale = lang === 'zh-HK' ? 'zh-HK' : 'en'
  const t = await getTranslations('pulse')

  const profile = await requireAuth(locale)
  const entitlement = resolveCommercialEntitlement(profile.accounts)

  const sql = db()
  const clientRows = await sql`
    select brand_name from clients
    where id = ${clientId} and account_id = ${profile.account_id}
    limit 1
  `
  const client = clientRows[0] as { brand_name: string } | undefined
  // 404 rather than 403 — the id came from the caller, and confirming it exists
  // would tell them it belongs to somebody.
  if (!client) notFound()

  // Editing is Pro+. Checked after ownership here, unlike the API: this page is
  // reached by navigation rather than by guessing ids, so an owner on a lower
  // plan should see their own brand's locked state rather than a 404.
  if (!entitlement.features.edit_prompts) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
        <Card>
          <CardContent className="p-8 text-center">
            <LockKeyhole className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
            <h1 className="mt-4 text-xl font-semibold">{t('qb_title')}</h1>
            <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted-foreground">
              {t('qb_locked_body')}
            </p>
            <Button asChild className="mt-6 min-h-11">
              <Link href={`/${locale}/pricing`}>{t('qb_see_plans')}</Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    )
  }

  // Same ordering as the API: created_at is transaction time, so every row an
  // onboarding writes shares one value, and the id tiebreak is what keeps
  // intra-category order stable between renders.
  const promptRows = await sql`
    select id, client_id, category, question, language, is_active, created_at
    from prompt_bank
    where client_id = ${clientId}
    order by category, created_at, id
    limit ${MAX_PROMPTS}
  `
  const prompts = promptRows as unknown as PromptBankItem[]

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <div className="mb-6">
        <p className="text-sm font-medium text-primary">{client.brand_name}</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">{t('qb_title')}</h1>
      </div>
      <PromptBankEditor clientId={clientId} initialPrompts={prompts} />
    </main>
  )
}
