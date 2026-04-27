import { getProfile } from '@/lib/auth'
import { createServerSupabaseClient } from '@/lib/supabase-server'

async function verifyPromptOwnership(promptId: string, clientId: string, accountId: string) {
  const supabase = await createServerSupabaseClient()
  const { data } = await supabase
    .from('prompt_bank')
    .select('id, clients!inner(account_id)')
    .eq('id', promptId).eq('client_id', clientId).single()
  if (!data) return false
  return (data as any).clients?.account_id === accountId
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ clientId: string; promptId: string }> }
) {
  const { clientId, promptId } = await params
  const profile = await getProfile()
  if (!profile) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!await verifyPromptOwnership(promptId, clientId, profile.account_id))
    return Response.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json()
  const updates: Record<string, unknown> = {}
  if (typeof body.question   === 'string')  updates.question  = body.question
  if (typeof body.is_active  === 'boolean') updates.is_active = body.is_active
  if (!Object.keys(updates).length)
    return Response.json({ error: 'No fields to update' }, { status: 400 })

  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('prompt_bank').update(updates).eq('id', promptId).select().single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ prompt: data })
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ clientId: string; promptId: string }> }
) {
  const { clientId, promptId } = await params
  const profile = await getProfile()
  if (!profile) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!await verifyPromptOwnership(promptId, clientId, profile.account_id))
    return Response.json({ error: 'Not found' }, { status: 404 })

  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.from('prompt_bank').delete().eq('id', promptId)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return new Response(null, { status: 204 })
}
