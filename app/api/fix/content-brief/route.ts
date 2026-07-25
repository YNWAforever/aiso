import { NextRequest, NextResponse } from 'next/server'
import { callOpenRouter } from '@/lib/openrouter'
import { createServerSupabaseClient } from '@/lib/supabase'
import { getProfile } from '@/lib/auth'
import { db } from '@/lib/db'
import type { IndustryCode } from '@/lib/types'
import { INDUSTRY_PACKS } from '@/lib/authority/packs'

// Ownership is checked via Neon because lib/supabase points at a deleted project
async function ownsClient(clientId: string, accountId: string): Promise<boolean> {
  const rows = await db()`
    select id from clients
    where id = ${clientId} and account_id = ${accountId}
    limit 1
  `
  return rows.length > 0
}

export async function POST(req: NextRequest) {
  const profile = await getProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { clientId, targetTopic, industry, region } = await req.json()
  if (!clientId || !targetTopic || !industry) {
    return NextResponse.json({ error: 'clientId, targetTopic, industry required' }, { status: 400 })
  }

  let owned = false
  try {
    owned = await ownsClient(clientId, profile.account_id)
  } catch (error) {
    console.error('[fix/content-brief] ownership check failed:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  // 404 rather than 403 so the endpoint does not leak client existence
  if (!owned) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const supabase = createServerSupabaseClient()
  const pack = INDUSTRY_PACKS[industry as IndustryCode]
  const recommendedDomains = [
    ...(pack?.authorityDomains.tier1 ?? []).slice(0, 3),
    ...(pack?.authorityDomains.tier2 ?? []).slice(0, 2),
  ]

  const prompt = `You are an AEO content strategist. Create a content brief for:
TOPIC: "${targetTopic}", INDUSTRY: ${industry}, REGION: ${region ?? 'global'}

Return JSON:
{
  "titleSuggestions": ["title 1","title 2","title 3","title 4","title 5"],
  "sections": [{"heading":"string","estimatedWords":number}],
  "requiredOriginalDataPoints": ["data 1","data 2","data 3"],
  "suggestedFaq": ["q1","q2","q3","q4","q5"],
  "recommendedSchema": {"@type":"Article"},
  "chunkabilityRequirements": {"idealChunkLength":"600-1000 tokens","answerFirst":true,"selfContained":true}
}

Target 2000-3000 word pillar page with 6-8 sections.`

  const aiResponse = await callOpenRouter({
    model: 'anthropic/claude-sonnet-4-5',
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 1200,
  })

  let brief: object = {}
  try { brief = JSON.parse(aiResponse.match(/\{[\s\S]+\}/)?.[0] ?? '{}') } catch {}

  const authorityWithReasons = recommendedDomains.map(d => ({ domain: d, tier: 'tier1', reason: `Top ${industry} authority source` }))
  const fullBrief = { targetTopic, ...brief, requiredAuthorities: authorityWithReasons }

  const { data: saved } = await supabase
    .from('content_briefs')
    .insert({ client_id: clientId, target_topic: targetTopic, brief_markdown: JSON.stringify(fullBrief, null, 2), recommended_authorities: authorityWithReasons })
    .select('id')
    .single()

  return NextResponse.json({ id: saved?.id, brief: fullBrief })
}
