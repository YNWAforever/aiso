import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { LockKeyhole } from 'lucide-react'

import { WhatAiSaysPage } from '@/components/dashboard/sme/WhatAiSaysPage'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { QuestionBankSection } from '@/components/pulse/QuestionBankSection'
import { requireAuth } from '@/lib/auth'
import { isSmeCopilotUiEnabled } from '@/lib/flags'
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
 * Renders QuestionBankSection, which adds the "Suggest more" panel on top of the
 * editor. That wrapper was skipped while /api/pulse/suggest-questions was fenced
 * and while its accept handler wrote to a second copy of the list the editor
 * never re-read; both are fixed, so the full surface is live.
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
    select brand_name, region,
      (select draft->>'language' from onboarding_progress op where op.client_id = clients.id and op.account_id = clients.account_id) as prompt_language
    from clients
    where id = ${clientId} and account_id = ${profile.account_id}
    limit 1
  `
  const client = clientRows[0] as { brand_name: string; region?: string | null; prompt_language?: string | null } | undefined
  // 404 rather than 403 — the id came from the caller, and confirming it exists
  // would tell them it belongs to somebody.
  if (!client) notFound()

  // Editing is Pro+. Checked after ownership here, unlike the API: this page is
  // reached by navigation rather than by guessing ids, so an owner on a lower
  // plan should see their own brand's locked state rather than a 404.
  if (!entitlement.features.edit_prompts) {
    return (
      <WhatAiSaysPage title={t('qb_title')}>
        <Card>
          <CardContent className="p-8 text-center">
            <LockKeyhole className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
            <p className="mx-auto mt-4 max-w-lg text-sm leading-6 text-muted-foreground">
              {t('qb_locked_body')}
            </p>
            <Button asChild className="mt-6 min-h-11">
              <Link href={`/${locale}/pricing`}>{t('qb_see_plans')}</Link>
            </Button>
          </CardContent>
        </Card>
      </WhatAiSaysPage>
    )
  }

  // Same ordering as the API: created_at is transaction time, so every row an
  // onboarding writes shares one value, and the id tiebreak is what keeps
  // intra-category order stable between renders.
  const promptRows = await sql`
    select p.id, p.client_id, p.category, p.question, p.language, p.market, p.is_active, p.source, p.created_at
    from prompt_bank p join clients c on c.id = p.client_id
    where p.client_id = ${clientId} and c.account_id = ${profile.account_id}
    order by p.category, p.created_at, p.id
    limit ${MAX_PROMPTS}
  `
  const prompts = promptRows as unknown as PromptBankItem[]
  const guided = isSmeCopilotUiEnabled() ? await getTranslations('runProgress.sme') : null

  return (
    <WhatAiSaysPage
      title={t('qb_title')}
      actions={guided ? (
        <Link className="inline-flex min-h-11 items-center rounded-lg border border-border px-4 text-sm font-medium" href={`/${locale}/dashboard/${encodeURIComponent(clientId)}?step=monitor#first-monitoring`}>{guided('backToMonitoring')}</Link>
      ) : undefined}
    >
      <QuestionBankSection clientId={clientId} initialPrompts={prompts} isFirstTime={false} contextDefaults={{ language: client.prompt_language, market: client.region }} />
    </WhatAiSaysPage>
  )
}
