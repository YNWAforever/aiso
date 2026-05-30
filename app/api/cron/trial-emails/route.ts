// app/api/cron/trial-emails/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

export const dynamic = 'force-dynamic'

// Bitmask: which email has been sent
const EMAIL_DAY1  = 1   // bit 0
const EMAIL_DAY5  = 2   // bit 1
const EMAIL_DAY7  = 4   // bit 2
const EMAIL_DAY10 = 8   // bit 3

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24))
}

export async function GET(req: NextRequest) {
  // Verify cron secret to prevent abuse
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  const resend = new Resend(process.env.RESEND_API_KEY)
  const from = process.env.RESEND_FROM_EMAIL ?? 'hello@fimmick-aeo.com'
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://aeo.fimmick.com'

  // Fetch all trial accounts that have an email
  const { data: accounts } = await supabase
    .from('accounts')
    .select('id, trial_started_at, trial_emails_sent, profiles(email, display_name)')
    .not('trial_started_at', 'is', null)

  if (!accounts) return NextResponse.json({ sent: 0 })

  let sent = 0
  for (const account of accounts) {
    const startedAt = account.trial_started_at as string
    const days = daysSince(startedAt)
    let currentMask = Number(account.trial_emails_sent ?? 0)
    const profile = Array.isArray(account.profiles) ? account.profiles[0] : account.profiles
    const email = (profile as { email?: string })?.email
    if (!email) continue

    const toSend: Array<{ bit: number; subject: string; text: string }> = []

    if (days >= 1  && !(currentMask & EMAIL_DAY1)) {
      toSend.push({ bit: EMAIL_DAY1, subject: '✅ Your AISO Fix Pack is ready — deploy these 3 files', text: `Your 7-day trial is active.\n\nDownload your Fix Pack from your dashboard:\n${appUrl}/en/dashboard\n\nThe 3 files (llms.txt, robots.txt patch, FAQ schema) are ready to deploy. Most sites see AI indexing improve within 48 hours of deploying llms.txt.\n\nYou have 6 days remaining on your trial.\n\n— Fimmick AISO` })
    }
    if (days >= 5  && !(currentMask & EMAIL_DAY5)) {
      toSend.push({ bit: EMAIL_DAY5, subject: "⏳ 2 days left — here's what you're missing in Pulse", text: `Your trial ends in 2 days.\n\nYou haven't seen AI Pulse yet — it tracks your brand's share of voice across ChatGPT, Perplexity, Claude, and Gemini every week.\n\nUpgrade to Pro and see where your brand shows up (and doesn't):\n${appUrl}/en/pricing\n\n— Fimmick AISO` })
    }
    if (days >= 7  && !(currentMask & EMAIL_DAY7)) {
      toSend.push({ bit: EMAIL_DAY7, subject: '🔔 Last day of your AISO trial', text: `Today is the last day of your free trial.\n\nKeep your dashboard, Fix Pack, and AI visibility report by upgrading:\n${appUrl}/en/pricing\n\nBasic plan starts at $29/month — no credit card was required for your trial, but you'll need one to continue.\n\n— Fimmick AISO` })
    }
    if (days >= 10 && !(currentMask & EMAIL_DAY10)) {
      toSend.push({ bit: EMAIL_DAY10, subject: 'Your AISO report is saved — come back anytime', text: `Your trial ended a few days ago, but your scan report and AISO score are still waiting for you.\n\nNo pressure — whenever you're ready:\n${appUrl}/en/pricing\n\n— Fimmick AISO` })
    }

    for (const { bit, subject, text } of toSend) {
      try {
        await resend.emails.send({ from, to: email, subject, text })
        currentMask = currentMask | bit
        await supabase.from('accounts')
          .update({ trial_emails_sent: currentMask })
          .eq('id', account.id)
        sent++
      } catch (err) {
        console.error(`[trial-emails] failed to send to ${email}:`, err)
      }
    }
  }

  return NextResponse.json({ sent })
}
