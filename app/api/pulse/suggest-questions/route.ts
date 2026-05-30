import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { callOpenRouter } from '@/lib/openrouter'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body?.clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })

  const { clientId, count = 5 } = body as { clientId: string; count?: number }

  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 })

  // Fetch client info + existing questions (to avoid duplication)
  const [{ data: client }, { data: existing }] = await Promise.all([
    supabase.from('clients').select('brand_name, industry').eq('id', clientId).single(),
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
