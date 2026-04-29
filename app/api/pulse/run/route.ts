import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'
import { callMultiPlatform } from '@/lib/openrouter'
import type { IndustryCode } from '@/lib/types'

function extractCitedUrls(text: string): string[] {
  const urlPattern = /https?:\/\/[^\s<>"',)]+/g
  return [...new Set((text.match(urlPattern) ?? []))]
}

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret')
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { clientId } = await req.json()
  const supabase = createServerSupabaseClient()

  const { data: client } = await supabase
    .from('clients')
    .select('brand_name, industry, domain')
    .eq('id', clientId)
    .single()

  if (!client) return NextResponse.json({ error: 'client not found' }, { status: 404 })

  const { data: prompts } = await supabase
    .from('prompt_bank')
    .select('id, question, category')
    .eq('client_id', clientId)
    .eq('is_active', true)
    .limit(50)

  if (!prompts?.length) return NextResponse.json({ processed: 0, citations: 0 })

  const pulseRunId = crypto.randomUUID()
  const industry = (client.industry ?? 'general_b2c') as IndustryCode
  let totalCitations = 0

  for (const prompt of prompts) {
    const responses = await callMultiPlatform(
      [{ role: 'user', content: prompt.question }],
      500
    ).catch(() => [])

    for (const response of responses) {
      const mentioned = response.answer.toLowerCase().includes(client.brand_name.toLowerCase())
      const citedUrls = extractCitedUrls(response.answer)

      await supabase.from('pulse_metrics').insert({
        client_id: clientId, prompt_id: prompt.id,
        platform: response.platform, question: prompt.question,
        raw_answer: response.answer, brand_mentioned: mentioned,
        sentiment: mentioned ? 'positive' : 'not_mentioned',
        scan_week: new Date().toISOString().slice(0, 10),
      })

      for (const url of citedUrls) {
        let domain: string
        try { domain = new URL(url).hostname } catch { continue }
        await supabase.from('ai_citation_log').insert({
          pulse_run_id: pulseRunId, client_id: clientId,
          cited_url: url, cited_domain: domain,
          platform: response.platform,
          prompt_industry: industry, prompt_topic: prompt.category,
          prompt_text: prompt.question, cited_at: new Date().toISOString(),
        })
        totalCitations++
      }
    }
  }

  return NextResponse.json({ pulseRunId, processed: prompts.length, citations: totalCitations })
}
