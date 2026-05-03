import { notFound } from 'next/navigation'
import { requireAuth } from '@/lib/auth'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { PlanGate } from '@/components/dashboard/PlanGate'
import { TopBar }   from '@/components/dashboard/TopBar'
import { planAllows } from '@/lib/tier'
import { PromptBankEditor } from '@/components/pulse/PromptBankEditor'
import type { PromptBankItem } from '@/lib/types'

export default async function PromptsPage({
  params,
}: { params: Promise<{ lang: string; clientId: string }> }) {
  const { lang, clientId } = await params
  const profile  = await requireAuth(lang)
  const plan     = profile.accounts?.plan ?? 'basic'
  const supabase = await createServerSupabaseClient()

  const { data: client } = await supabase
    .from('clients').select('brand_name')
    .eq('id', clientId).eq('account_id', profile.account_id).single()

  if (!client) notFound()

  const { data: promptsRaw } = await supabase
    .from('prompt_bank').select('*')
    .eq('client_id', clientId).order('category').order('created_at')

  return (
    <>
      <TopBar title={`${client.brand_name} — Prompt Bank`} />
      <main className="flex-1 px-6 py-8 max-w-3xl">
        <PlanGate allowed={planAllows(plan, 'edit_prompts')} lang={lang}>
          <PromptBankEditor clientId={clientId} initialPrompts={(promptsRaw ?? []) as PromptBankItem[]} />
        </PlanGate>
      </main>
    </>
  )
}
