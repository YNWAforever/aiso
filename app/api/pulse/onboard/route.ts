import { NextRequest, NextResponse } from 'next/server'
import { supabase }       from '@/lib/supabase'
import { callOpenRouter } from '@/lib/openrouter'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const { brandName, industry, competitors } = await req.json()

  if (!brandName) return NextResponse.json({ error: 'brandName required' }, { status: 400 })

  const { data: client, error: clientError } = await supabase
    .from('clients')
    .insert({ brand_name: brandName, industry: industry ?? null, competitors: competitors ?? [] })
    .select('id')
    .single()

  if (clientError) return NextResponse.json({ error: 'DB error' }, { status: 500 })

  const raw = await callOpenRouter({
    model: 'anthropic/claude-haiku-4-5',
    maxTokens: 4000,
    messages: [{
      role: 'user',
      content: `品牌：${brandName}
行業：${industry ?? '未指定'}
競品：${(competitors ?? []).join(', ') || '未指定'}

生成 50 條問題，分 4 類（brand_query/category_query/intent_query/pain_point），每類 12-13 條。
返回 JSON array（只輸出 array，無其他文字）：[{"category":"brand_query","question":"...","language":"zh-HK"}]`,
    }],
  })

  let prompts: Array<{ category: string; question: string; language: string }>
  try {
    const match = raw.match(/\[[\s\S]*\]/)
    prompts = JSON.parse(match?.[0] ?? raw)
  } catch {
    return NextResponse.json({ error: 'Failed to parse prompts' }, { status: 500 })
  }

  const rows = prompts.map(p => ({
    client_id: client.id,
    category: p.category,
    question: p.question,
    language: p.language ?? 'zh-HK',
  }))

  const { error: promptError } = await supabase.from('prompt_bank').insert(rows)
  if (promptError) return NextResponse.json({ error: 'Failed to save prompts' }, { status: 500 })

  return NextResponse.json({ clientId: client.id, promptCount: rows.length })
}
