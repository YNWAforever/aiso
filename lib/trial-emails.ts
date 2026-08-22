// Bitmask: which drip email has already been sent for an account.
export const EMAIL_DAY1 = 1
export const EMAIL_DAY5 = 2
export const EMAIL_DAY7 = 4
export const EMAIL_DAY10 = 8

export interface TrialEmail {
  bit: number
  subject: string
  text: string
}

/**
 * `accounts.trial_started_at` is a `timestamptz` — the Neon driver returns
 * those as a JS `Date`, but ISO strings still arrive from Supabase-era rows
 * and test fixtures. Mirrors lib/tier.ts's timestampMs: accept both.
 */
function timestampMs(raw: string | Date): number {
  return raw instanceof Date ? raw.getTime() : new Date(raw).getTime()
}

export function daysSinceTrialStart(startedAt: string | Date): number {
  return Math.floor((Date.now() - timestampMs(startedAt)) / (1000 * 60 * 60 * 24))
}

/** Which of the 4 drip emails are newly due, given elapsed days and what's already sent. */
export function pendingTrialEmails(days: number, sentMask: number, appUrl: string): TrialEmail[] {
  const toSend: TrialEmail[] = []

  if (days >= 1 && !(sentMask & EMAIL_DAY1)) {
    toSend.push({
      bit: EMAIL_DAY1,
      subject: '✅ Your AISO Fix Pack is ready — deploy these 3 files',
      text: `Your 7-day trial is active.\n\nDownload your Fix Pack from your dashboard:\n${appUrl}/en/dashboard\n\nThe 3 files (llms.txt, robots.txt patch, FAQ schema) are ready to deploy. Most sites see AI indexing improve within 48 hours of deploying llms.txt.\n\nYou have 6 days remaining on your trial.\n\n— Fimmick AISO`,
    })
  }
  if (days >= 5 && !(sentMask & EMAIL_DAY5)) {
    toSend.push({
      bit: EMAIL_DAY5,
      subject: "⏳ 2 days left — here's what you're missing in Pulse",
      text: `Your trial ends in 2 days.\n\nYou haven't seen AI Pulse yet — it tracks your brand's share of voice across ChatGPT, Perplexity, Claude, and Gemini every week.\n\nUpgrade to Pro and see where your brand shows up (and doesn't):\n${appUrl}/en/pricing\n\n— Fimmick AISO`,
    })
  }
  if (days >= 7 && !(sentMask & EMAIL_DAY7)) {
    toSend.push({
      bit: EMAIL_DAY7,
      subject: '🔔 Last day of your AISO trial',
      text: `Today is the last day of your free trial.\n\nKeep your dashboard, Fix Pack, and AI visibility report by upgrading:\n${appUrl}/en/pricing\n\nBasic plan starts at $29/month — no credit card was required for your trial, but you'll need one to continue.\n\n— Fimmick AISO`,
    })
  }
  if (days >= 10 && !(sentMask & EMAIL_DAY10)) {
    toSend.push({
      bit: EMAIL_DAY10,
      subject: 'Your AISO report is saved — come back anytime',
      text: `Your trial ended a few days ago, but your scan report and AISO score are still waiting for you.\n\nNo pressure — whenever you're ready:\n${appUrl}/en/pricing\n\n— Fimmick AISO`,
    })
  }

  return toSend
}
