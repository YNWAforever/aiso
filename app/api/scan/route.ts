import { NextRequest, NextResponse } from 'next/server'
import { checkRobots }         from '@/lib/checks/robots'

export const dynamic = 'force-dynamic'
import { checkLlmsTxt }        from '@/lib/checks/llmsTxt'
import { checkBotAccess }      from '@/lib/checks/botAccess'
import { checkStructuredData } from '@/lib/checks/structuredData'
import { checkExtractability } from '@/lib/checks/extractability'
import { supabase }            from '@/lib/supabase'
import type { ScanResults }    from '@/lib/types'

const WEIGHTS = {
  c1_robots:          0.175,
  c2_llms_txt:        0.175,
  c3_bot_access:      0.300,
  c4_structured_data: 0.175,
  c5_extractability:  0.175,
}
const SCORES = { pass: 100, warn: 50, fail: 0 } as const

export function calculateScore(results: ScanResults): number {
  return (Object.keys(WEIGHTS) as Array<keyof typeof WEIGHTS>).reduce((total, key) => {
    return total + SCORES[results[key].status] * WEIGHTS[key]
  }, 0)
}

export async function POST(req: NextRequest) {
  const { url } = await req.json()
  if (!url || typeof url !== 'string') {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
  }

  let baseUrl: string
  let domain: string
  try {
    const parsed = new URL(url.startsWith('http') ? url : `https://${url}`)
    baseUrl = parsed.origin
    domain  = parsed.hostname
  } catch {
    return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 })
  }

  const [c1, c2, c3, c4, c5] = await Promise.allSettled([
    checkRobots(baseUrl),
    checkLlmsTxt(baseUrl),
    checkBotAccess(baseUrl),
    checkStructuredData(baseUrl),
    checkExtractability(baseUrl),
  ])

  const err = { status: 'fail' as const, message: 'check_error' }
  const get = <T>(r: PromiseSettledResult<T>, fallback: T): T =>
    r.status === 'fulfilled' ? r.value : fallback

  const results: ScanResults = {
    c1_robots:          get(c1, err),
    c2_llms_txt:        get(c2, err),
    c3_bot_access:      get(c3, err),
    c4_structured_data: get(c4, err),
    c5_extractability:  get(c5, err),
  }

  const score = calculateScore(results)

  const { data, error } = await supabase
    .from('scans')
    .insert({ url: baseUrl, domain, score, results })
    .select('id')
    .single()

  if (error) return NextResponse.json({ error: 'Database error' }, { status: 500 })

  return NextResponse.json({ id: data.id, score, results })
}
