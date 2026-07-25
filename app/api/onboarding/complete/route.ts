import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { callOpenRouter } from '@/lib/openrouter'
import { getProfile } from '@/lib/auth'
import { db } from '@/lib/db'
import { maxBrandsForPlan } from '@/lib/tier'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const profile = await getProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const { brandName, domain, industry, region, description, competitors, scanId } = body as {
    brandName?: string; domain?: string; industry?: string; region?: string
    description?: string; competitors?: string[]; scanId?: string
  }

  if (!brandName) return NextResponse.json({ error: 'brandName required' }, { status: 400 })

  // Tenant key always comes from the session — never from the request body
  const accountId = profile.account_id
  const plan  = profile.accounts?.plan ?? 'basic'
  const limit = maxBrandsForPlan(plan)

  const sql = db()

  // Guard against double-submit: check if trial already started
  const trialAlreadyStarted = !!profile.accounts?.trial_started_at

  // Set trial dates on account (7-day trial) — only on first call
  const now = new Date()
  const trialEndsAt = trialAlreadyStarted
    ? new Date(profile.accounts!.trial_started_at!)
    : new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

  const supabase = await createServerSupabaseClient()

  if (!trialAlreadyStarted) {
    await supabase.from('accounts').update({
      trial_started_at: now.toISOString(),
      trial_ends_at: trialEndsAt.toISOString(),
    }).eq('id', accountId)
  }

  // Existing brands for THIS account only (no RLS — always filter by account_id)
  let existingClients: { id: string }[] = []
  try {
    existingClients = await sql`
      select id from clients where account_id = ${accountId} order by created_at asc
    ` as { id: string }[]
  } catch (err) {
    console.warn('[onboarding] client lookup failed:', (err as Error)?.message ?? String(err))
    return NextResponse.json({ error: 'Failed to create client' }, { status: 500 })
  }

  // Guard against duplicate clients: return existing client if account already has one
  if (existingClients[0]) {
    return NextResponse.json({ clientId: existingClients[0].id, trialEndsAt: trialEndsAt.toISOString() })
  }

  // Per-plan brand cap — same shape as POST /api/dashboard/clients.
  // Defence in depth: the idempotency guard above already caps onboarding at one
  // brand per account, so this only bites if that guard is ever relaxed.
  if (existingClients.length >= limit) {
    return NextResponse.json(
      { error: 'BRAND_LIMIT_REACHED', plan, limit },
      { status: 403 }
    )
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

  // Link scan to account if provided — only claimable scans (unclaimed, or
  // already owned by this account). Silently a no-op for anyone else's scan
  // so the endpoint does not leak whether that scan exists.
  if (scanId) {
    try {
      await sql`
        update scans set account_id = ${accountId}
        where id = ${scanId} and (account_id is null or account_id = ${accountId})
      `
    } catch (err) {
      console.warn('[onboarding] scan link failed:', (err as Error)?.message ?? String(err))
    }
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
