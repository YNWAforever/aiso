import { db } from '@/lib/db'
import { appOrigin } from '@/lib/app-origin'
import { startCronRun, finishCronRun } from '@/lib/cron/recordRun'
import { sendTrialEmail } from '@/lib/resend'
import { daysSinceTrialStart, pendingTrialEmails } from '@/lib/trial-emails'

export const dynamic = 'force-dynamic'

type TrialAccountRow = {
  id: string
  trial_started_at: string | Date
  trial_emails_sent: number
  email: string | null
}

/**
 * Read the secret, or null when it is missing or too short to be one.
 *
 * Compared against a known-present value, so an unset var can never make an
 * absent header match — this route's pre-fence version compared against
 * `Bearer undefined` and would have accepted that literal string.
 */
function cronSecret(): string | null {
  const secret = process.env.CRON_SECRET
  if (!secret || secret.length < 16) return null
  return secret
}

export async function GET(req: Request) {
  const secret = cronSecret()
  if (!secret) {
    console.error('[cron/trial-emails] CRON_SECRET is unset or shorter than 16 characters')
    return Response.json({ error: 'Server misconfiguration' }, { status: 500 })
  }
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const runId = await startCronRun('/api/cron/trial-emails')
  try {
    const sql = db()
    // Never select both accounts.id and profiles.id unaliased — the Neon HTTP
    // driver builds each row via Object.fromEntries, so two columns sharing an
    // output name silently collide, last one wins. profiles.id is only needed
    // to break ties deterministically in ORDER BY, not in the SELECT list.
    const rows = (await sql`
      SELECT DISTINCT ON (a.id)
        a.id, a.trial_started_at, a.trial_emails_sent, u.email
      FROM accounts a
      JOIN profiles p ON p.account_id = a.id
      LEFT JOIN neon_auth."user" u ON u.id = p.id
      WHERE a.trial_started_at IS NOT NULL
        AND (a.stripe_subscription_id IS NULL OR a.stripe_subscription_id = '')
      ORDER BY a.id ASC, p.id ASC
    `) as TrialAccountRow[]

    const appUrl = appOrigin()
    let sent = 0
    let failed = 0

    for (const row of rows) {
      if (!row.email) continue

      const days = daysSinceTrialStart(row.trial_started_at)
      let mask = Number(row.trial_emails_sent ?? 0)
      const due = pendingTrialEmails(days, mask, appUrl)

      for (const email of due) {
        // Send-then-persist, not claim-then-send (contrast lib/alerts/evaluate.ts's
        // deliverEmail). If the UPDATE below throws after a successful send, the
        // bit is lost and the next cron run resends this one email — accepted here
        // because these are low-stakes marketing emails, not billing-critical
        // alerts, and a full claim/release ledger would be disproportionate.
        try {
          await sendTrialEmail({ to: row.email, subject: email.subject, text: email.text })
          mask |= email.bit
          await sql`UPDATE accounts SET trial_emails_sent = ${mask} WHERE id = ${row.id}`
          sent++
        } catch (err) {
          console.error(`[cron/trial-emails] failed to send to account ${row.id}:`, err)
          failed++
        }
      }
    }

    await finishCronRun(runId, 'ok', { sent, failed })
    return Response.json({ sent, failed }, { status: failed > 0 ? 502 : 200 })
  } catch (err) {
    await finishCronRun(runId, 'error', undefined, err instanceof Error ? err.message : String(err))
    throw err
  }
}
