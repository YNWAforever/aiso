import { NextRequest, NextResponse } from 'next/server'
import { callOpenRouter } from '@/lib/openrouter'
import { getProfile } from '@/lib/auth'
import { db } from '@/lib/db'
import { claimScanForAccount } from '@/app/api/scans/[id]/claim/route'

export const dynamic = 'force-dynamic'

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

// accounts.trial_started_at / trial_ends_at are timestamptz — the Neon driver
// returns those as Date objects, not ISO strings (see fix(tier): accept a
// Date trial expiry). Test fixtures and any row written by the old
// Supabase-era code may still hand us a string, so accept both.
function toDate(raw: unknown): Date | null {
  if (raw instanceof Date) return raw
  if (typeof raw === 'string' && raw) {
    const parsed = new Date(raw)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }
  return null
}

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

  const sql = db()
  const accountId = profile.account_id

  if (scanId) {
    const claim = await claimScanForAccount(scanId, accountId)
    if (claim.status === 'not-found') return NextResponse.json({ error: 'Scan not found' }, { status: 404 })
    if (claim.status === 'conflict') return NextResponse.json({ error: 'Scan belongs to another account' }, { status: 409 })
    if (claim.status === 'error') return NextResponse.json({ error: 'Failed to claim scan' }, { status: 500 })
  }

  // Guard against double-submit: check if trial already started
  let account: { trial_started_at: unknown; trial_ends_at: unknown } | undefined
  try {
    const rows = await sql`
      select trial_started_at, trial_ends_at from accounts where id = ${accountId} limit 1
    `
    account = rows[0] as { trial_started_at: unknown; trial_ends_at: unknown } | undefined
  } catch {
    return NextResponse.json({ error: 'Failed to load account' }, { status: 500 })
  }
  if (!account) {
    return NextResponse.json({ error: 'Failed to load account' }, { status: 500 })
  }

  const trialStartedAt = toDate(account.trial_started_at)
  const trialAlreadyStarted = !!trialStartedAt
  const storedTrialEndsAt = toDate(account.trial_ends_at)
  const now = new Date()

  // Set trial dates on account (7-day trial) — only on first call
  const trialEndsAt = trialAlreadyStarted
    ? (storedTrialEndsAt ?? new Date(trialStartedAt!.getTime() + SEVEN_DAYS_MS))
    : new Date(now.getTime() + SEVEN_DAYS_MS)

  if (!trialAlreadyStarted) {
    try {
      const updated = await sql`
        update accounts
        set trial_started_at = ${now.toISOString()}, trial_ends_at = ${trialEndsAt.toISOString()}
        where id = ${accountId}
        returning id
      `
      if (!updated[0]) return NextResponse.json({ error: 'Failed to start trial' }, { status: 500 })
    } catch {
      return NextResponse.json({ error: 'Failed to start trial' }, { status: 500 })
    }
  } else if (!storedTrialEndsAt) {
    try {
      const updated = await sql`
        update accounts set trial_ends_at = ${trialEndsAt.toISOString()}
        where id = ${accountId}
        returning id
      `
      if (!updated[0]) return NextResponse.json({ error: 'Failed to start trial' }, { status: 500 })
    } catch {
      return NextResponse.json({ error: 'Failed to start trial' }, { status: 500 })
    }
  }

  // Guard against duplicate clients: return existing client if account already has one
  let existingClientId: string | null = null
  try {
    const rows = await sql`
      select id from clients where account_id = ${accountId} limit 1
    `
    existingClientId = (rows[0]?.id as string | undefined) ?? null
  } catch {
    return NextResponse.json({ error: 'Failed to load client' }, { status: 500 })
  }

  if (existingClientId) {
    // A resumed onboarding (double-submit) must still associate the scan
    // with the brand — this early-return path skips client creation but not
    // the stamp. scans_client_tenant_fkey rejects a cross-account pairing,
    // which cannot happen here since both ids come from this same account_id.
    if (scanId) {
      try {
        await sql`
          update scans set client_id = ${existingClientId}
          where id = ${scanId} and account_id = ${accountId} and client_id is null
        `
      } catch (err) {
        console.error('[onboarding] failed to associate scan with existing client:', (err as Error)?.message ?? String(err))
        return NextResponse.json({ error: 'Failed to associate scan with client' }, { status: 500 })
      }
    }
    return NextResponse.json({ clientId: existingClientId, scanId: scanId ?? null, trialEndsAt: trialEndsAt.toISOString() })
  }

  // Create client. competitors is text[], not jsonb — pass the array
  // straight through with an explicit cast, no JSON.stringify.
  let clientId: string
  try {
    const rows = await sql`
      insert into clients (brand_name, domain, industry, region, description, competitors, account_id, status)
      values (
        ${brandName},
        ${domain ?? null},
        ${industry ?? null},
        ${region ?? null},
        ${description ?? null},
        ${(Array.isArray(competitors) ? competitors : []) as string[]}::text[],
        ${accountId},
        'active'
      )
      returning id
    `
    if (!rows[0]) return NextResponse.json({ error: 'Failed to create client' }, { status: 500 })
    clientId = rows[0].id as string
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('BRAND_LIMIT_REACHED')) {
      return NextResponse.json({ error: 'BRAND_LIMIT_REACHED' }, { status: 403 })
    }
    return NextResponse.json({ error: 'Failed to create client' }, { status: 500 })
  }

  if (scanId) {
    try {
      await sql`
        update scans set client_id = ${clientId}
        where id = ${scanId} and account_id = ${accountId} and client_id is null
      `
    } catch (err) {
      console.error('[onboarding] failed to associate scan with new client:', (err as Error)?.message ?? String(err))
      return NextResponse.json({ error: 'Failed to associate scan with client' }, { status: 500 })
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
    if (prompts.length > 0) {
      // Neon's driver is tagged-template only, so a ~24-row bulk insert is
      // built with unnest() over parallel arrays rather than string concat.
      const categories = prompts.map(p => p.category)
      const questions = prompts.map(p => p.question)
      const languages = prompts.map(p => p.language ?? 'en')
      await sql`
        insert into prompt_bank (client_id, category, question, language, is_active)
        select ${clientId}, cat, q, lang, true
        from unnest(${categories}::text[], ${questions}::text[], ${languages}::text[]) as t(cat, q, lang)
      `
    }
  } catch (err) {
    // Prompt generation failure is non-fatal — client still created
    console.warn('[onboarding] prompt generation failed:', (err as Error)?.message ?? String(err))
  }

  return NextResponse.json({ clientId, scanId: scanId ?? null, trialEndsAt: trialEndsAt.toISOString() })
}
