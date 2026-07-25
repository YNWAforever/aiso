import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { callOpenRouter } from '@/lib/openrouter'
import { getProfile } from '@/lib/auth'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

// There is no RLS in effect — the caller-supplied clientId must be proven to
// belong to the caller's account before we spend any LLM budget on it.
// Fails closed on error.
async function ownsClient(clientId: string, accountId: string): Promise<boolean> {
  try {
    const sql = db()
    const rows = await sql`
      select id from clients
      where id = ${clientId} and account_id = ${accountId}
      limit 1
    `
    return rows.length > 0
  } catch {
    return false
  }
}

export async function POST(req: NextRequest) {
  // Auth gate first — anonymous callers must not reach the OpenRouter call.
  const profile = await getProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  if (!body?.clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })

  const rawCount = typeof body.count === 'number' ? body.count : 5
  const count = Math.min(Math.max(1, rawCount), 10)
  const { clientId } = body as { clientId: string }

  // 404 rather than 403 so the endpoint does not leak which clientIds exist
  if (!await ownsClient(clientId, profile.account_id))
    return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Fetch client info + existing questions — ownership already enforced above
  const supabase = await createServerSupabaseClient()
  const [{ data: client }, { data: existing }] = await Promise.all([
    supabase.from('clients').select('brand_name, industry')
      .eq('id', clientId).eq('account_id', profile.account_id).single(),
    supabase.from('prompt_bank').select('question, category').eq('client_id', clientId).limit(50),
  ])

  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

  const existingList = (existing ?? []).map((p: { question: string; category: string }) => `- ${p.question}`).join('\n')

  const raw = await callOpenRouter({
    model: 'openai/gpt-4o-mini',
    maxTokens: 800,
    messages: [{
      role: 'user',
      content: `Brand: ${client.brand_name}\nIndustry: ${client.industry ?? 'general'}\n\nExisting questions (do NOT repeat these):\n${existingList || '(none yet)'}\n\nGenerate ${count} NEW, diverse questions for tracking this brand's AI visibility. Mix categories: brand_query, category_query, intent_query, pain_point.\n\nReturn ONLY a JSON array: [{"question":"...","category":"brand_query"}]`,
    }],
  }).catch(() => '[]')

  let suggestions: Array<{ question: string; category: string }> = []
  try {
    const match = raw.match(/\[[\s\S]*\]/)
    suggestions = JSON.parse(match?.[0] ?? raw)
  } catch { /* return empty */ }

  return NextResponse.json({ suggestions: suggestions.slice(0, count) })
}
