import { NextRequest, NextResponse } from 'next/server'
import { callOpenRouter, type JsonSchemaFormat } from '@/lib/openrouter'
import { getProfile } from '@/lib/auth'
import { db } from '@/lib/db'
import { INDUSTRY_PACKS } from '@/lib/authority/packs'
import type { IndustryCode } from '@/lib/types'

export const dynamic = 'force-dynamic'

const topicList = { type: 'array', items: { type: 'string' } }

const CLUSTER_MAP_FORMAT: JsonSchemaFormat = {
  name: 'cluster_map',
  schema: {
    type: 'object',
    properties: {
      clientClusters: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            topic: { type: 'string' },
            completenessScore: { type: 'integer', description: '0-100' },
            recommendation: { type: 'string' },
          },
          required: ['topic', 'completenessScore', 'recommendation'],
          additionalProperties: false,
        },
      },
      recommendedNewClusters: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            topic: { type: 'string' },
            priority: { type: 'string', enum: ['high', 'medium', 'low'] },
            rationale: { type: 'string' },
          },
          required: ['topic', 'priority', 'rationale'],
          additionalProperties: false,
        },
      },
      priorityOrder: { ...topicList, description: 'Topics to work on, most important first.' },
      // No competitor data reaches this prompt, so the field is described as what
      // the model can actually infer rather than as observed competitor coverage.
      competitorGaps: { ...topicList, description: 'Topics this industry commonly covers that the existing clusters lack.' },
    },
    required: ['clientClusters', 'recommendedNewClusters', 'priorityOrder', 'competitorGaps'],
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

type TopicalCluster = {
  topic: string
  pillar_page_url: string | null
  completeness_score: number | null
}

export async function POST(req: NextRequest) {
  const profile = await getProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { clientId, industry } = await req.json()
  if (!clientId || !industry) {
    return NextResponse.json({ error: 'clientId and industry required' }, { status: 400 })
  }

  let owned = false
  try {
    owned = await ownsClient(clientId, profile.account_id)
  } catch (error) {
    console.error('[fix/cluster-map] ownership check failed:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  // 404 rather than 403 so the endpoint does not leak client existence
  if (!owned) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let clusters: TopicalCluster[]
  try {
    clusters = (await db()`
      select topic, pillar_page_url, completeness_score
      from topical_clusters
      where client_id = ${clientId}
    `) as TopicalCluster[]
  } catch (error) {
    console.error('[fix/cluster-map] cluster lookup failed:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }

  const keywords = INDUSTRY_PACKS[industry as IndustryCode]?.topicalKeywords?.slice(0, 15) ?? []

  const prompt = `Create a topical cluster map for ${industry} industry AEO.
Existing clusters: ${JSON.stringify(clusters)}
Industry keywords: ${keywords.join(', ')}`

  const raw = await callOpenRouter({
    label: 'fix.cluster_map',
    model: 'anthropic/claude-sonnet-4-5',
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 1200,
    responseFormat: CLUSTER_MAP_FORMAT,
  })

  let clusterMap: object
  try {
    const match = raw.match(/\{[\s\S]*\}/)
    clusterMap = JSON.parse(match?.[0] ?? raw)
  } catch {
    return NextResponse.json({ error: 'Failed to parse LLM response' }, { status: 500 })
  }

  return NextResponse.json({ clusterMap })
}
