import { getProfile } from '@/lib/auth'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import type { PromptBankItem } from '@/lib/types'

export function groupByCategory(prompts: PromptBankItem[]): Record<string, PromptBankItem[]> {
  return prompts.reduce<Record<string, PromptBankItem[]>>((acc, p) => {
    if (!acc[p.category]) acc[p.category] = []
    acc[p.category].push(p)
    return acc
  }, {})
}

async function verifyOwnership(clientId: string, accountId: string) {
  const supabase = await createServerSupabaseClient()
  const { data } = await supabase
    .from('clients').select('id')
    .eq('id', clientId).eq('account_id', accountId).single()
  return !!data
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const { clientId } = await params
  const profile = await getProfile()
  if (!profile) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!await verifyOwnership(clientId, profile.account_id))
    return Response.json({ error: 'Not found' }, { status: 404 })

  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('prompt_bank').select('*')
    .eq('client_id', clientId).order('category').order('created_at')

  if (error) return Response.json({ error: error.message }, { status: 500 })
  const prompts = (data ?? []) as PromptBankItem[]
  return Response.json({ prompts, grouped: groupByCategory(prompts) })
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const { clientId } = await params
  const profile = await getProfile()
  if (!profile) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!await verifyOwnership(clientId, profile.account_id))
    return Response.json({ error: 'Not found' }, { status: 404 })

  const { category, question, language } = await req.json()
  if (!category || !question)
    return Response.json({ error: 'category and question required' }, { status: 400 })

  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('prompt_bank')
    .insert({ client_id: clientId, category, question, language: language ?? 'en', is_active: true })
    .select().single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ prompt: data }, { status: 201 })
}
