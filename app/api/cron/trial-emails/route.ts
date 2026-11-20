import { randomUUID } from 'node:crypto'
import { db } from '@/lib/db'
import { appOrigin } from '@/lib/app-origin'
import { startCronRun, finishCronRun } from '@/lib/cron/recordRun'
import { sendTrialEmail, trialEmailSender } from '@/lib/resend'
import { buildTrialEmail, type TrialEmailBit } from '@/lib/trial-emails'

export const dynamic = 'force-dynamic'

type TrialAccountRow = {
  id: string
  trial_started_at: string
  trial_ends_at: string
  trial_email_locale: 'en' | 'zh-HK' | null
  milestone: TrialEmailBit
  email: string
}

type Delivery = { id: string; payload: { to: string; from: string; subject: string; text: string } }
const RUN_BUDGET_MS = 40_000

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

/**
 * A bounded, de-identified provider error name for the run ledger.
 *
 * The run used to record only {sent, failed}, which is true but undiagnosable:
 * the first production `0 9` firing failed all 17 sends and the ledger could not
 * say why. The failure message may embed the recipient address, so only a
 * closed-vocabulary `name` survives (Resend uses e.g. `validation_error`,
 * `rate_limit_exceeded`); anything unrecognisable becomes `unknown`.
 */
function providerErrorCode(err: unknown): string {
  // Resend's constructor throws before any request when the key is missing. That is
  // a configuration fault rather than a provider reply, but it was the actual cause
  // of the first two production firings, so name it instead of the outer Error's
  // generic 'error'. The message is matched, never recorded, and embeds no recipient.
  if (err instanceof Error && /missing api key/i.test(err.message)) return 'missing_api_key'
  const cause = err instanceof Error ? err.cause : undefined
  const candidate =
    cause && typeof cause === 'object' && 'name' in cause && typeof (cause as { name?: unknown }).name === 'string'
      ? (cause as { name: string }).name
      : err instanceof Error ? err.name : 'unknown'
  return /^[a-z][a-z0-9_]{2,40}$/i.test(candidate) ? candidate.toLowerCase() : 'unknown'
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
  const started = Date.now()
  try {
    const sql = db()
    const review = await sql`
      with expired as (
        select id, account_id from trial_email_deliveries
        where sent_at is null and needs_review_at is null and started_at <= now() - interval '23 hours'
          and (lease_until is null or lease_until <= now())
        order by started_at limit 100
      )
      update trial_email_deliveries d set needs_review_at = now(), payload = null
      from expired e where d.id = e.id and d.account_id = e.account_id and d.sent_at is null
        and d.needs_review_at is null and (d.lease_until is null or d.lease_until <= now())
      returning d.id
    `
    // Preserve PostgreSQL's microseconds for the exact claim predicates below.
    const rows = (await sql`
      select a.id,
        to_char(a.trial_started_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as trial_started_at,
        to_char(a.trial_ends_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as trial_ends_at,
        a.trial_email_locale, due.milestone, owner.email
      from accounts a
      cross join lateral (select due_trial_email_bit(a.trial_started_at, a.trial_ends_at, now()) as milestone) due
      cross join lateral (
        select u.email from profiles p join neon_auth."user" u on u.id = p.id
        where p.account_id = a.id and p.deactivated_at is null
        order by p.created_at, p.id limit 1
      ) owner
      where due.milestone is not null and (coalesce(a.trial_emails_sent, 0) & (16 - due.milestone)) = 0
        and coalesce(a.stripe_subscription_id, '') = '' and a.status not in ('past_due', 'cancelled')
        and (a.override_plan is null or a.override_expires_at <= now()) and owner.email is not null
        and not exists (select 1 from trial_email_deliveries d where d.account_id = a.id
          and d.trial_started_at = a.trial_started_at and d.milestone = due.milestone
          and (d.sent_at is not null or d.needs_review_at is not null or d.lease_until > now()))
      order by a.trial_ends_at, a.id limit 100
    `) as TrialAccountRow[]

    const appUrl = appOrigin()
    let sent = 0
    let failed = 0
    let deferred = 0
    const errorCodes = new Set<string>()

    for (const [index, row] of rows.entries()) {
      if (Date.now() - started >= RUN_BUDGET_MS) {
        deferred = rows.length - index
        break
      }
      const owner = randomUUID()
      const email = buildTrialEmail(row.milestone, row.trial_ends_at, row.trial_email_locale === 'zh-HK' ? 'zh-HK' : 'en', appUrl)
      const payload = { ...email, to: row.email, from: trialEmailSender() }
      try {
        const [, [claim]] = await sql.transaction([
          sql`select id from accounts where id = ${row.id}::uuid for update`,
          sql`insert into trial_email_deliveries (account_id, trial_started_at, milestone, payload, lease_owner, lease_until)
            select a.id, a.trial_started_at, ${row.milestone}, ${JSON.stringify(payload)}::jsonb,
              ${owner}::uuid, now() + interval '2 minutes'
            from accounts a where a.id = ${row.id}::uuid and a.trial_started_at = ${row.trial_started_at}::timestamptz
              and a.trial_ends_at = ${row.trial_ends_at}::timestamptz
              and due_trial_email_bit(a.trial_started_at, a.trial_ends_at, now()) = ${row.milestone}
              and (coalesce(a.trial_emails_sent, 0) & (16 - ${row.milestone}::integer)) = 0
              and coalesce(a.stripe_subscription_id, '') = '' and a.status not in ('past_due', 'cancelled')
              and (a.override_plan is null or a.override_expires_at <= now())
              and (select u.email from profiles p join neon_auth."user" u on u.id = p.id
                where p.account_id = a.id and p.deactivated_at is null order by p.created_at, p.id limit 1) = ${row.email}
              and not exists (select 1 from trial_email_deliveries d where d.account_id = a.id and d.lease_until > now())
            on conflict (account_id, trial_started_at, milestone) do update
              set lease_owner = excluded.lease_owner, lease_until = excluded.lease_until
              where trial_email_deliveries.sent_at is null and trial_email_deliveries.needs_review_at is null
                and trial_email_deliveries.started_at > now() - interval '23 hours'
                and trial_email_deliveries.payload->>'to' = excluded.payload->>'to'
            returning id, payload`,
        ])
        if (!claim) continue
        const delivery = claim as Delivery
        const providerId = await sendTrialEmail({ ...delivery.payload, idempotencyKey: `aiso:trial:${delivery.id}` })
        if (!providerId) throw new Error('Provider response lacked an email ID')
        const [settled] = await sql`
          with receipt as (
            update trial_email_deliveries set sent_at = now(), provider_email_id = ${providerId}, payload = null,
              lease_owner = null, lease_until = null
            where id = ${delivery.id}::uuid and account_id = ${row.id}::uuid and lease_owner = ${owner}::uuid
            returning account_id, trial_started_at, milestone
          )
          update accounts a set trial_emails_sent = coalesce(a.trial_emails_sent, 0) | r.milestone
          from receipt r where a.id = r.account_id and a.trial_started_at = r.trial_started_at
          returning a.id
        `
        if (!settled) throw new Error('Delivery receipt could not be confirmed')
        sent++
      } catch (error) {
        failed++
        errorCodes.add(providerErrorCode(error))
      }
    }

    const detail = { sent, failed, deferred, needsReview: review.length, ...(failed && { errorCodes: [...errorCodes].slice(0, 5) }) }
    await finishCronRun(runId, failed > 0 ? 'error' : 'ok', detail)
    return Response.json(detail, { status: failed > 0 ? 502 : 200 })
  } catch {
    await finishCronRun(runId, 'error', undefined, 'trial_email_storage_failure')
    return Response.json({ error: 'Trial email delivery unavailable' }, { status: 503 })
  }
}
