import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { callOpenRouter } from '@/lib/openrouter'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const { brandName, domain, industry, region, description, competitors, scanId } = body as {
    brandName?: string; domain?: string; industry?: string; region?: string
    description?: string; competitors?: string[]; scanId?: string
  }

  if (!brandName) return NextResponse.json({ error: 'brandName required' }, { status: 400 })

  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 })

  // Get account
  const { data: profile } = await supabase
    .from('profiles').select('account_id').eq('id', user.id).single()
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  const accountId = profile.account_id

  // Guard against double-submit: check if trial already started
  const { data: account } = await supabase
    .from('accounts').select('trial_started_at').eq('id', accountId).single()
  const trialAlreadyStarted = !!account?.trial_started_at

  // Set trial dates on account (7-day trial) — only on first call
  const now = new Date()
  const trialEndsAt = trialAlreadyStarted
    ? new Date(account!.trial_started_at!)
    : new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

  if (!trialAlreadyStarted) {
    await supabase.from('accounts').update({
      trial_started_at: now.toISOString(),
      trial_ends_at: trialEndsAt.toISOString(),
    }).eq('id', accountId)
  }

  // Guard against duplicate clients: return existing client if account already has one
  const { data: existingClient } = await supabase
    .from('clients').select('id').eq('account_id', accountId).limit(1).single()
  if (existingClient) {
    return NextResponse.json({ clientId: existingClient.id, trialEndsAt: trialEndsAt.toISOString() })
  }

  // Create client
  const { data: clientData, error: clientError } = await supabase
    .from('clients')
    .insert({
      brand_name: brandName,
      domain: domain ?? null,
      industry: industry ?? null,
      region: region ?? null,
      description: description ?? null,
      competitors: competitors ?? [],
      account_id: accountId,
      status: 'active',
    })
    .select('id')
    .single()

  if (clientError || !clientData) {
    return NextResponse.json({ error: 'Failed to create client' }, { status: 500 })
  }
  const clientId = clientData.id

  // Link scan to account if provided
  if (scanId) {
    await supabase.from('scans')
      .update({ account_id: accountId })
      .eq('id', scanId)
  }

  // Generate seed prompts via OpenRouter
  try {
    const raw = await callOpenRouter({
      model: 'anthropic/claude-haiku-4-5',
      maxTokens: 3000,
      messages: [{
        role: 'user',
        content: `Brand: ${brandName}\nIndustry: ${industry ?? 'general'}\nDomain: ${domain ?? ''}\nDescription: ${description ?? ''}\nCompetitors: ${(competitors ?? []).join(', ') || 'none specified'}\n\nGenerate 24 questions in 4 categories (brand_query, category_query, intent_query, pain_point), 6 per category. Return ONLY a JSON array: [{"category":"brand_query","question":"...","language":"en"}]`,
      }],
    })
    const match = raw.match(/\[[\s\S]*\]/)
    const prompts = JSON.parse(match?.[0] ?? raw) as Array<{ category: string; question: string; language: string }>
    const rows = prompts.map(p => ({
      client_id: clientId,
      category: p.category,
      question: p.question,
      language: p.language ?? 'en',
      is_active: true,
    }))
    await supabase.from('prompt_bank').insert(rows)
  } catch (err) {
    // Prompt generation failure is non-fatal — client still created
    console.warn('[onboarding] prompt generation failed:', (err as Error)?.message ?? String(err))
  }

  return NextResponse.json({ clientId, trialEndsAt: trialEndsAt.toISOString() })
}
