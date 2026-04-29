import { NextRequest, NextResponse } from 'next/server'
import { callOpenRouter } from '@/lib/openrouter'
import { createServerSupabaseClient } from '@/lib/supabase'
import { INDUSTRY_PACKS } from '@/lib/authority/packs'
import type { IndustryCode } from '@/lib/types'

export async function POST(req: NextRequest) {
  const { clientId, industry } = await req.json()
  if (!clientId || !industry) return NextResponse.json({ error: 'clientId and industry required' }, { status: 400 })

  const supabase = createServerSupabaseClient()
  const { data: clusters } = await supabase
    .from('topical_clusters')
    .select('topic, pillar_page_url, completeness_score')
    .eq('client_id', clientId)

  const keywords = INDUSTRY_PACKS[industry as IndustryCode]?.topicalKeywords?.slice(0, 15) ?? []

  const prompt = `Create a topical cluster map for ${industry} industry AEO.
Existing clusters: ${JSON.stringify(clusters ?? [])}
Industry keywords: ${keywords.join(', ')}

Return JSON:
{
  "clientClusters": [{"topic":"string","completenessScore":number,"recommendation":"string"}],
  "recommendedNewClusters": [{"topic":"string","priority":"high|medium|low","rationale":"string"}],
  "priorityOrder": ["topic 1","topic 2","topic 3"],
  "competitorGaps": ["topic competitors have that client lacks"]
}`

  const res = await callOpenRouter({ model: 'anthropic/claude-sonnet-4-5', messages: [{ role: 'user', content: prompt }], maxTokens: 1200 })
  let clusterMap: object = {}
  try { clusterMap = JSON.parse(res.match(/\{[\s\S]+\}/)?.[0] ?? '{}') } catch {}

  return NextResponse.json({ clusterMap })
}
