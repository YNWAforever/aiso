import { NextRequest, NextResponse } from 'next/server'
import { callOpenRouter, type JsonSchemaFormat } from '@/lib/openrouter'
import { getProfile } from '@/lib/auth'
import { db } from '@/lib/db'
import { INDUSTRY_PACKS } from '@/lib/authority/packs'
import type { IndustryCode } from '@/lib/types'

export const dynamic = 'force-dynamic'

// The same for every brief, so it is set here rather than asked of the model.
const CHUNKABILITY = { idealChunkLength: '600-1000 tokens', answerFirst: true, selfContained: true } as const

const stringList = { type: 'array', items: { type: 'string' } }

const BRIEF_FORMAT: JsonSchemaFormat = {
  name: 'content_brief',
  schema: {
    type: 'object',
    properties: {
      titleSuggestions: { ...stringList, description: 'Five candidate titles.' },
      sections: {
        type: 'array',
        items: {
          type: 'object',
          properties: { heading: { type: 'string' }, estimatedWords: { type: 'integer' } },
          required: ['heading', 'estimatedWords'],
          additionalProperties: false,
        },
      },
      requiredOriginalDataPoints: { ...stringList, description: 'Original data the page needs in order to be citable.' },
      suggestedFaq: { ...stringList, description: 'Five questions.' },
      recommendedSchema: {
        type: 'object',
        properties: { '@type': { type: 'string', description: 'The schema.org type that best fits this page.' } },
        required: ['@type'],
        additionalProperties: false,
      },
    },
    required: ['titleSuggestions', 'sections', 'requiredOriginalDataPoints', 'suggestedFaq', 'recommendedSchema'],
    additionalProperties: false,
  },
}

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

  const pack = INDUSTRY_PACKS[industry as IndustryCode]
  const recommendedDomains = [
    ...(pack?.authorityDomains.tier1 ?? []).slice(0, 3),
    ...(pack?.authorityDomains.tier2 ?? []).slice(0, 2),
  ]

  const prompt = `You are an AEO content strategist. Create a content brief for:
TOPIC: "${targetTopic}", INDUSTRY: ${industry}, REGION: ${region ?? 'global'}

Target 2000-3000 word pillar page with 6-8 sections.`

  const aiResponse = await callOpenRouter({
    label: 'fix.content_brief',
    model: 'anthropic/claude-sonnet-4-5',
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 1200,
    responseFormat: BRIEF_FORMAT,
  })

  let brief: object
  try {
    const match = aiResponse.match(/\{[\s\S]*\}/)
    brief = JSON.parse(match?.[0] ?? aiResponse)
  } catch {
    return NextResponse.json({ error: 'Failed to parse LLM response' }, { status: 500 })
  }

  const authorityWithReasons = recommendedDomains.map(d => ({
    domain: d,
    tier: 'tier1',
    reason: `Top ${industry} authority source`,
  }))
  const fullBrief = { targetTopic, ...brief, chunkabilityRequirements: CHUNKABILITY, requiredAuthorities: authorityWithReasons }

  let id: string
  try {
    const rows = await db()`
      insert into content_briefs (client_id, target_topic, brief_markdown, recommended_authorities)
      values (${clientId}, ${targetTopic}, ${JSON.stringify(fullBrief, null, 2)}, ${JSON.stringify(authorityWithReasons)}::jsonb)
      returning id
    `
    id = (rows[0] as { id: string }).id
  } catch (error) {
    console.error('[fix/content-brief] brief save failed:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }

  return NextResponse.json({ id, brief: fullBrief })
}
