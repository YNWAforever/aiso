import { notFound } from 'next/navigation'
import { requireAuth } from '@/lib/auth'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { PlanGate } from '@/components/dashboard/PlanGate'
import { TopBar }   from '@/components/dashboard/TopBar'
import { planAllows } from '@/lib/tier'

export default async function PromptsPage({
  params,
}: {
  params: Promise<{ lang: string; clientId: string }>
}) {
  const { lang, clientId } = await params
  const profile  = await requireAuth(lang)
  const plan     = profile.accounts?.plan ?? 'starter'
  const supabase = await createServerSupabaseClient()

  const { data: client } = await supabase
    .from('clients')
    .select('brand_name')
    .eq('id', clientId)
    .eq('account_id', profile.account_id)
    .single()

  if (!client) notFound()

  return (
    <>
      <TopBar title={`${client.brand_name} — Prompt Bank`} />
      <main className="flex-1 px-6 py-8">
        <PlanGate allowed={planAllows(plan, 'editPrompts')} lang={lang}>
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <p className="text-sm font-semibold text-slate-700 mb-4">Prompt Bank Editor</p>
            <p className="text-slate-400 text-sm">Prompt editing UI coming in Phase 3B.</p>
          </div>
        </PlanGate>
      </main>
    </>
  )
}
