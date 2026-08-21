import type { AlertConfig, Notification } from '@/lib/types'

export type AlertType = 'sov_threshold' | 'sov_wow_drop' | 'sov_recovery'

export interface AlertConfigWithClient extends AlertConfig {
  id: string
  client: {
    id: string
    brand_name: string
    account_id: string
  }
}

export interface AlertWeekSnapshot {
  client_id: string
  scan_week: string
  sov_score: number | null
}

export interface AlertSnapshot {
  configs: AlertConfigWithClient[]
  weeksByClient: Record<string, AlertWeekSnapshot[]>
  emailsByAccount: Record<string, string | null | undefined>
  dashboardUrlByClient: Record<string, string | undefined>
  /**
   * The ISO Monday of the week the DATABASE believes it is now.
   *
   * Required, not optional, so the TypeScript compiler forces every
   * application construction site to supply it -- an optional field would let
   * a caller omit it and silently disable the staleness guard, which is the
   * one thing this field exists to prevent. That guarantee stops at the
   * `tsc --noEmit` boundary: `tsconfig.json` excludes `__tests__` from
   * typechecking, so a hand-rolled `: AlertSnapshot` test fixture that omits
   * this field still compiles and runs. Fixtures must be kept in sync by
   * hand -- see `__tests__/lib/alerts/evaluate.test.ts`.
   */
  currentScanWeek: string
}

export type AlertNotificationInput = Omit<Notification, 'id' | 'created_at'>

export interface AlertEmailInput {
  to: string
  clientId: string
  brandName: string
  type: AlertType
  currentSov: number
  previousSov?: number
  threshold: number
  dashboardUrl: string
}

/**
 * Identity of one alert email for the delivery ledger.
 *
 * The natural key is (client_id, type, scan_week) — that's the ledger's
 * unique index. recipient is not part of the key: it's payload recorded on
 * insert, not used to match an existing row.
 *
 * Separate from AlertEmailInput because the ledger keys on the week while the
 * email body does not mention it.
 */
export interface AlertEmailDeliveryKey {
  client_id: string
  type: AlertType
  scan_week: string
  recipient: string
}

export interface AlertEvaluationPorts {
  loadSnapshot: () => Promise<AlertSnapshot>
  upsertNotification: (notification: AlertNotificationInput) => Promise<void>
  /** Insert the ledger row. Returns false when a row for this key already exists. */
  claimEmailDelivery: (key: AlertEmailDeliveryKey) => Promise<boolean>
  /** Undo a claim whose send then failed, so a later run can retry it. */
  releaseEmailDelivery: (key: AlertEmailDeliveryKey) => Promise<void>
  sendAlertEmail: (email: AlertEmailInput) => Promise<void>
}

interface AlertAction {
  notification: AlertNotificationInput | null
  email: AlertEmailInput | null
  emailKey: AlertEmailDeliveryKey | null
}

export async function runAlertEvaluation(ports: AlertEvaluationPorts): Promise<{
  processed: number
  stale: number
  fired: number
  emailed: number
  deferred: number
  emailFailures: number
  notificationFailures: number
}> {
  const snapshot = await ports.loadSnapshot()
  const actions: AlertAction[] = []
  let stale = 0

  for (const config of snapshot.configs) {
    const weeks = snapshot.weeksByClient[config.client_id] ?? []
    if (!weeks.length) continue

    const latest = weeks[0]
    const previous = weeks[1]

    // Evaluate only the current week. Without this the run re-derives last
    // week's action, the ledger claim for it already exists, and the outcome is
    // 'suppressed' -- indistinguishable from a healthy re-run while this
    // client's real alert is dropped. Nothing orders the Pulse rollup before
    // this cron except two schedule times three and a half hours apart.
    //
    // console.warn, not console.error: a lagging rollup 3.5 hours after
    // schedule is the expected transient case, not a code fault -- matching
    // how onboarding/complete already draws this line (warn for
    // degraded-but-non-fatal, error for real failures like a failed query or
    // an unset CRON_SECRET). The systemic case -- every client stale -- is
    // what escalates to a 502 downstream.
    if (latest.scan_week !== snapshot.currentScanWeek) {
      console.warn(
        `[alerts] client ${config.client_id}: latest aggregate week is ` +
        `${latest.scan_week}, expected ${snapshot.currentScanWeek} — skipping. ` +
        'The Pulse rollup has not landed for this client this week.',
      )
      stale++
      continue
    }

    const latestScore = latest.sov_score
    if (latestScore === null) continue

    const previousScore = previous?.sov_score

    if (config.enabled_sov && latestScore < config.sov_threshold) {
      const wasAboveThreshold = !previous || (
        previousScore !== null &&
        previousScore !== undefined &&
        previousScore >= config.sov_threshold
      )
      if (wasAboveThreshold) {
        actions.push(buildAction({
          config,
          latest,
          currentSov: latestScore,
          previousSov: previousScore ?? undefined,
          snapshot,
          type: 'sov_threshold',
          title: `SoV Alert — ${config.client.brand_name}`,
          message: `SoV fell below ${config.sov_threshold}% threshold (current: ${latestScore}%).`,
          threshold: config.sov_threshold,
        }))
      }
    }

    if (config.enabled_wow && previous && previousScore !== null && previousScore !== undefined) {
      const drop = previousScore - latestScore
      if (drop >= config.wow_threshold) {
        actions.push(buildAction({
          config,
          latest,
          currentSov: latestScore,
          previousSov: previousScore,
          snapshot,
          type: 'sov_wow_drop',
          title: `SoV Alert — ${config.client.brand_name}`,
          message: `SoV dropped ${drop} points this week (${previous.sov_score}% → ${latest.sov_score}%). Threshold: ${config.wow_threshold} points.`,
          threshold: config.wow_threshold,
        }))
      }
    }

    if (
      config.enabled_sov &&
      previousScore !== null &&
      previousScore !== undefined &&
      latestScore >= config.sov_threshold &&
      previousScore < config.sov_threshold
    ) {
      actions.push(buildAction({
        config,
        latest,
        currentSov: latestScore,
        previousSov: previousScore,
        snapshot,
        type: 'sov_recovery',
        title: `SoV Recovered — ${config.client.brand_name}`,
        message: `SoV back above ${config.sov_threshold}% threshold (current: ${latestScore}%).`,
        threshold: config.sov_threshold,
      }))
    }
  }

  let emailed = 0
  let emailFailures = 0
  let notificationFailures = 0

  for (const action of actions) {
    if (action.notification) {
      try {
        await ports.upsertNotification(action.notification)
      } catch (error) {
        console.error('[alerts] notification failed:', error)
        notificationFailures++
      }
    }

    if (action.email && action.emailKey) {
      const outcome = await deliverEmail(ports, action.email, action.emailKey)
      if (outcome === 'sent') emailed++
      else if (outcome === 'failed') emailFailures++
      // 'suppressed' means this key was already delivered this scan_week —
      // a healthy re-run, not a failure, so it counts toward neither total.
    }
  }

  return {
    processed: snapshot.configs.length,
    stale,
    fired: actions.length,
    emailed,
    deferred: 0,
    emailFailures,
    notificationFailures,
  }
}

type EmailDeliveryOutcome = 'sent' | 'suppressed' | 'failed'

/**
 * Send one alert email at most once per client, type and week.
 *
 * Claim first, then send. The reverse order would re-send every alert whenever
 * a run was retried, which is what happened before the ledger existed: the
 * notification insert deduped through its unique index while the email did not.
 *
 * The guarantee below covers only sends that raise an exception inside this
 * process: the claim is handed back so a later run can retry, turning the
 * loss into a delayed email rather than a permanently swallowed one. It does
 * NOT cover a process death between a successful claim and the send call
 * (function timeout, redeploy, host crash) — the claim row is left behind
 * with no compensating release, the unique index then blocks re-claiming it,
 * and that one alert goes permanently unsent for the rest of that scan_week.
 * That is the correct, inherent behaviour of claim-then-send without a lease;
 * fixing it would mean adding a lease/TTL, which is out of scope here.
 *
 * A failed claim sends nothing at all -- a dead ledger cannot record what
 * went out, so proceeding would reintroduce the same duplicate-send bug with
 * no record to stop it. The caller must surface 'failed' outcomes rather than
 * treat them as silently equivalent to 'suppressed': an outage and a healthy
 * re-run both send zero emails, and only the outcome distinguishes them.
 */
async function deliverEmail(
  ports: AlertEvaluationPorts,
  email: AlertEmailInput,
  key: AlertEmailDeliveryKey,
): Promise<EmailDeliveryOutcome> {
  let claimed = false
  try {
    claimed = await ports.claimEmailDelivery(key)
  } catch (error) {
    console.error('[alerts] email claim failed:', error)
    return 'failed'
  }

  if (!claimed) return 'suppressed'

  try {
    await ports.sendAlertEmail(email)
    return 'sent'
  } catch (error) {
    console.error('[alerts] email failed:', error)
    try {
      await ports.releaseEmailDelivery(key)
    } catch (releaseError) {
      console.error('[alerts] email claim release failed:', releaseError)
    }
    return 'failed'
  }
}

function buildAction({
  config,
  latest,
  currentSov,
  previousSov,
  snapshot,
  type,
  title,
  message,
  threshold,
}: {
  config: AlertConfigWithClient
  latest: AlertWeekSnapshot
  currentSov: number
  previousSov?: number
  snapshot: AlertSnapshot
  type: AlertType
  title: string
  message: string
  threshold: number
}): AlertAction {
  const userEmail = snapshot.emailsByAccount[config.client.account_id] ?? null
  const dashboardUrl = snapshot.dashboardUrlByClient[config.client_id]

  const email: AlertEmailInput | null =
    config.notify_email && userEmail && dashboardUrl
      ? {
          to: userEmail,
          clientId: config.client_id,
          brandName: config.client.brand_name,
          type,
          currentSov,
          previousSov,
          threshold,
          dashboardUrl,
        }
      : null

  return {
    notification: config.notify_inapp
      ? {
          account_id: config.client.account_id,
          client_id: config.client_id,
          type,
          title,
          message,
          read: false,
          scan_week: latest.scan_week,
        }
      : null,
    email,
    emailKey: email
      ? {
          client_id: config.client_id,
          type,
          scan_week: latest.scan_week,
          recipient: email.to,
        }
      : null,
  }
}
