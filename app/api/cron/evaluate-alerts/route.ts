import { createClient } from '@supabase/supabase-js'
import { sendAlertEmail } from '@/lib/resend'

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(req: Request) {
  // ── Security guard ─────────────────────────────────────────
  // Reject immediately if CRON_SECRET is not configured — an
  // empty env var would otherwise allow unauthenticated access.
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    console.error('evaluate-alerts: CRON_SECRET env var is not set')
    return Response.json({ error: 'Cron not configured' }, { status: 500 })
  }

  const incomingSecret = req.headers.get('x-cron-secret')
  if (!incomingSecret || incomingSecret !== cronSecret) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = serviceClient()

  // ── 1. Fetch all enabled alert configs with client data ─────
  const { data: configs } = await supabase
    .from('alert_configs')
    .select('*, clients(id, brand_name, account_id)')
    .or('enabled_sov.eq.true,enabled_wow.eq.true')

  if (!configs?.length) return Response.json({ processed: 0, fired: 0 })

  // Shape of the joined clients relation on each alert config row
  type CfgClient = { id: string; brand_name: string; account_id: string } | null

  // ── 2. Batch pre-fetch to eliminate N+1 queries ─────────────

  // Collect unique client IDs and account IDs up front
  const clientIds  = [...new Set(
    configs.map(c => (c as { clients?: CfgClient }).clients?.id).filter(Boolean) as string[]
  )]
  const accountIds = [...new Set(
    configs.map(c => (c as { clients?: CfgClient }).clients?.account_id).filter(Boolean) as string[]
  )]

  // One query for all pulse data we need
  const { data: allWeeks } = await supabase
    .from('pulse_weekly_summary')
    .select('client_id, scan_week, sov_score, total_queries')
    .in('client_id', clientIds)
    .is('platform', null)
    .order('scan_week', { ascending: false })

  // One query for all relevant profiles
  const { data: allProfiles } = await supabase
    .from('profiles')
    .select('id, account_id')
    .in('account_id', accountIds)

  // Build email map: account_id → email (one auth call per unique user)
  const emailMap: Record<string, string | null> = {}
  for (const profile of allProfiles ?? []) {
    if (profile.account_id in emailMap) continue // already fetched
    const { data: { user } } = await supabase.auth.admin.getUserById(profile.id)
    emailMap[profile.account_id] = user?.email ?? null
  }

  // Build lookup: client_id → last 2 aggregate weeks (descending order preserved)
  const weeksByClient: Record<string, typeof allWeeks> = {}
  for (const w of allWeeks ?? []) {
    if (!weeksByClient[w.client_id]) weeksByClient[w.client_id] = []
    if ((weeksByClient[w.client_id]!.length) < 2)
      weeksByClient[w.client_id]!.push(w)
  }

  // ── 3. Evaluate each alert config ──────────────────────────
  let fired = 0

  for (const cfg of configs) {
    const client = (cfg as { clients?: CfgClient }).clients
    if (!client) continue

    const { id: clientId, account_id: accountId, brand_name: brandName } = client

    const weeks  = weeksByClient[clientId] ?? []
    if (!weeks.length) continue

    const [latest, prev] = weeks
    const userEmail      = emailMap[accountId] ?? null
    const dashboardUrl   = `${process.env.NEXT_PUBLIC_APP_URL}/en/dashboard/${clientId}`
    const latestWeek     = latest.scan_week  // ISO date string e.g. "2026-04-21"

    // ── SoV threshold alert — only fires on crossing from above → below ──
    if (cfg.enabled_sov && latest.sov_score < cfg.sov_threshold) {
      const wasAbove = !prev || prev.sov_score >= cfg.sov_threshold
      if (wasAbove) {
        const notif = {
          account_id: accountId,
          client_id:  clientId,
          type:       'sov_threshold' as const,
          title:      `SoV Alert — ${brandName}`,
          message:    `SoV fell below ${cfg.sov_threshold}% threshold (current: ${latest.sov_score}%).`,
          read:       false,
          scan_week:  latestWeek,
        }
        // onConflict: do nothing = idempotent (dedup by client_id + type + scan_week)
        if (cfg.notify_inapp) {
          await supabase.from('notifications').upsert(notif, {
            onConflict:        'client_id,type,scan_week',
            ignoreDuplicates:  true,
          })
        }
        if (cfg.notify_email && userEmail) {
          try {
            await sendAlertEmail({ to: userEmail, brandName, type: 'sov_threshold',
              currentSov: latest.sov_score, threshold: cfg.sov_threshold, dashboardUrl })
          } catch (e) { console.error('Email send failed (sov_threshold):', e) }
        }
        fired++
      }
    }

    // ── WoW drop alert ───────────────────────────────────────
    if (cfg.enabled_wow && prev) {
      const drop = prev.sov_score - latest.sov_score
      if (drop >= cfg.wow_threshold) {
        const notif = {
          account_id: accountId,
          client_id:  clientId,
          type:       'sov_wow_drop' as const,
          title:      `SoV Alert — ${brandName}`,
          message:    `SoV dropped ${drop} points this week (${prev.sov_score}% → ${latest.sov_score}%). Threshold: ${cfg.wow_threshold} points.`,
          read:       false,
          scan_week:  latestWeek,
        }
        if (cfg.notify_inapp) {
          await supabase.from('notifications').upsert(notif, {
            onConflict:        'client_id,type,scan_week',
            ignoreDuplicates:  true,
          })
        }
        if (cfg.notify_email && userEmail) {
          try {
            await sendAlertEmail({ to: userEmail, brandName, type: 'sov_wow_drop',
              currentSov: latest.sov_score, previousSov: prev.sov_score,
              threshold: cfg.wow_threshold, dashboardUrl })
          } catch (e) { console.error('Email send failed (sov_wow_drop):', e) }
        }
        fired++
      }
    }

    // ── SoV recovery — crossing from below → above threshold ────
    if (cfg.enabled_sov && prev &&
        latest.sov_score >= cfg.sov_threshold && prev.sov_score < cfg.sov_threshold) {
      const notif = {
        account_id: accountId,
        client_id:  clientId,
        type:       'sov_recovery' as const,
        title:      `SoV Recovered — ${brandName}`,
        message:    `SoV back above ${cfg.sov_threshold}% threshold (current: ${latest.sov_score}%).`,
        read:       false,
        scan_week:  latestWeek,
      }
      if (cfg.notify_inapp) {
        await supabase.from('notifications').upsert(notif, {
          onConflict:        'client_id,type,scan_week',
          ignoreDuplicates:  true,
        })
      }
      if (cfg.notify_email && userEmail) {
        try {
          await sendAlertEmail({ to: userEmail, brandName, type: 'sov_recovery',
            currentSov: latest.sov_score, threshold: cfg.sov_threshold, dashboardUrl })
        } catch (e) { console.error('Email send failed (sov_recovery):', e) }
      }
      fired++
    }
  }

  return Response.json({ processed: configs.length, fired })
}
