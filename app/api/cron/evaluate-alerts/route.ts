import { createClient } from '@supabase/supabase-js'
import { sendAlertEmail } from '@/lib/resend'

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(req: Request) {
  const secret = req.headers.get('x-cron-secret')
  if (secret !== process.env.CRON_SECRET)
    return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = serviceClient()

  // Fetch all enabled alert configs with client data
  const { data: configs } = await supabase
    .from('alert_configs')
    .select('*, clients(id, brand_name, account_id)')
    .or('enabled_sov.eq.true,enabled_wow.eq.true')

  if (!configs?.length) return Response.json({ processed: 0, fired: 0 })

  let fired = 0

  for (const cfg of configs) {
    const client = (cfg as any).clients
    if (!client) continue

    const { id: clientId, account_id: accountId, brand_name: brandName } = client

    // Get last 2 aggregate weekly summaries
    const { data: weeks } = await supabase
      .from('pulse_weekly_summary').select('scan_week,sov_score,total_queries')
      .eq('client_id', clientId).is('platform', null)
      .order('scan_week', { ascending: false }).limit(2)

    if (!weeks?.length) continue

    const [latest, prev] = weeks

    // Get user email from auth
    const { data: profile } = await supabase.from('profiles').select('id')
      .eq('account_id', accountId).single()

    let userEmail: string | null = null
    if (profile) {
      const { data: { user } } = await supabase.auth.admin.getUserById(profile.id)
      userEmail = user?.email ?? null
    }

    const dashboardUrl = `${process.env.NEXT_PUBLIC_APP_URL}/en/dashboard/${clientId}`

    // SoV threshold alert — only fire when crossing from above to below
    if (cfg.enabled_sov && latest.sov_score < cfg.sov_threshold) {
      const wasAbove = !prev || prev.sov_score >= cfg.sov_threshold
      if (wasAbove) {
        const notif = {
          account_id: accountId, client_id: clientId, type: 'sov_threshold',
          title: `SoV Alert — ${brandName}`,
          message: `SoV fell below ${cfg.sov_threshold}% threshold (current: ${latest.sov_score}%).`,
          read: false,
        }
        if (cfg.notify_inapp) await supabase.from('notifications').insert(notif)
        if (cfg.notify_email && userEmail) {
          try {
            await sendAlertEmail({ to: userEmail, brandName, type: 'sov_threshold',
              currentSov: latest.sov_score, threshold: cfg.sov_threshold, dashboardUrl })
          } catch (e) { console.error('Email send failed:', e) }
        }
        fired++
      }
    }

    // WoW drop alert
    if (cfg.enabled_wow && prev) {
      const drop = prev.sov_score - latest.sov_score
      if (drop >= cfg.wow_threshold) {
        const notif = {
          account_id: accountId, client_id: clientId, type: 'sov_wow_drop',
          title: `SoV Alert — ${brandName}`,
          message: `SoV dropped ${drop} points this week (${prev.sov_score}% → ${latest.sov_score}%). Threshold: ${cfg.wow_threshold} points.`,
          read: false,
        }
        if (cfg.notify_inapp) await supabase.from('notifications').insert(notif)
        if (cfg.notify_email && userEmail) {
          try {
            await sendAlertEmail({ to: userEmail, brandName, type: 'sov_wow_drop',
              currentSov: latest.sov_score, previousSov: prev.sov_score,
              threshold: cfg.wow_threshold, dashboardUrl })
          } catch (e) { console.error('Email send failed:', e) }
        }
        fired++
      }
    }

    // SoV recovery — crossing from below to above threshold
    if (cfg.enabled_sov && prev && latest.sov_score >= cfg.sov_threshold && prev.sov_score < cfg.sov_threshold) {
      const notif = {
        account_id: accountId, client_id: clientId, type: 'sov_recovery',
        title: `SoV Recovered — ${brandName}`,
        message: `SoV back above ${cfg.sov_threshold}% threshold (current: ${latest.sov_score}%).`,
        read: false,
      }
      if (cfg.notify_inapp) await supabase.from('notifications').insert(notif)
      if (cfg.notify_email && userEmail) {
        try {
          await sendAlertEmail({ to: userEmail, brandName, type: 'sov_recovery',
            currentSov: latest.sov_score, threshold: cfg.sov_threshold, dashboardUrl })
        } catch (e) { console.error('Email send failed:', e) }
      }
      fired++
    }
  }

  return Response.json({ processed: configs.length, fired })
}
