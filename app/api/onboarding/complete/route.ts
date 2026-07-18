import { NextRequest, NextResponse } from 'next/server'
import { createServiceSupabaseClient } from '@/lib/supabase-server'
import { callOpenRouter } from '@/lib/openrouter'
import { getProfile } from '@/lib/auth'
import { claimScanForAccount } from '@/app/api/scans/[id]/claim/route'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const { brandName, domain, industry, region, description, competitors, scanId } = body as {
    brandName?: string; domain?: string; industry?: string; region?: string
    description?: string; competitors?: string[]; scanId?: string
  }

  if (!brandName) return NextResponse.json({ error: 'brandName required' }, { status: 400 })

  const profile = await getProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 })

  const supabase = await createServiceSupabaseClient()
  const accountId = profile.account_id

  if (scanId) {
    const claim = await claimScanForAccount(supabase, scanId, accountId)
    if (claim.status === 'not-found') return NextResponse.json({ error: 'Scan not found' }, { status: 404 })
    if (claim.status === 'conflict') return NextResponse.json({ error: 'Scan belongs to another account' }, { status: 409 })
    if (claim.status === 'error') return NextResponse.json({ error: 'Failed to claim scan' }, { status: 500 })
  }

  // Guard against double-submit: check if trial already started
  const { data: account, error: accountError } = await supabase
    .from('accounts').select('trial_started_at, trial_ends_at').eq('id', accountId).single()
  if (accountError || !account) {
    return NextResponse.json({ error: 'Failed to load account' }, { status: 500 })
  }
  const trialAlreadyStarted = !!account.trial_started_at

  // Set trial dates on account (7-day trial) — only on first call
  const now = new Date()
  const trialEndsAt = trialAlreadyStarted
    ? account.trial_ends_at
      ? new Date(account.trial_ends_at)
      : new Date(new Date(account.trial_started_at!).getTime() + 7 * 24 * 60 * 60 * 1000)
    : new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

  if (!trialAlreadyStarted) {
    const { data: updatedAccount, error: trialUpdateError } = await supabase.from('accounts').update({
      trial_started_at: now.toISOString(),
      trial_ends_at: trialEndsAt.toISOString(),
    }).eq('id', accountId).select('id').maybeSingle()
    if (trialUpdateError || !updatedAccount) {
      return NextResponse.json({ error: 'Failed to start trial' }, { status: 500 })
    }
  }

  // Guard against duplicate clients: return existing client if account already has one
  const { data: existingClient, error: existingClientError } = await supabase
    .from('clients').select('id').eq('account_id', accountId).limit(1).maybeSingle()
  if (existingClientError) {
    return NextResponse.json({ error: 'Failed to load client' }, { status: 500 })
  }
  if (existingClient) {
    return NextResponse.json({ clientId: existingClient.id, scanId: scanId ?? null, trialEndsAt: trialEndsAt.toISOString() })
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

  return NextResponse.json({ clientId, scanId: scanId ?? null, trialEndsAt: trialEndsAt.toISOString() })
}
