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
  sov_score: number
}

export interface AlertSnapshot {
  configs: AlertConfigWithClient[]
  weeksByClient: Record<string, AlertWeekSnapshot[]>
  emailsByAccount: Record<string, string | null | undefined>
  dashboardUrlByClient: Record<string, string | undefined>
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

export interface AlertEvaluationPorts {
  loadSnapshot: () => Promise<AlertSnapshot>
  upsertNotification: (notification: AlertNotificationInput) => Promise<void>
  sendAlertEmail: (email: AlertEmailInput) => Promise<void>
}

interface AlertAction {
  notification: AlertNotificationInput | null
  email: AlertEmailInput | null
}

export async function runAlertEvaluation(ports: AlertEvaluationPorts): Promise<{ processed: number; fired: number }> {
  const snapshot = await ports.loadSnapshot()
  const actions: AlertAction[] = []

  for (const config of snapshot.configs) {
    const weeks = snapshot.weeksByClient[config.client_id] ?? []
    if (!weeks.length) continue

    const latest = weeks[0]
    const previous = weeks[1]

    if (config.enabled_sov && latest.sov_score < config.sov_threshold) {
      const wasAboveThreshold = !previous || previous.sov_score >= config.sov_threshold
      if (wasAboveThreshold) {
        actions.push(buildAction({
          config,
          latest,
          previous,
          snapshot,
          type: 'sov_threshold',
          title: `SoV Alert — ${config.client.brand_name}`,
          message: `SoV fell below ${config.sov_threshold}% threshold (current: ${latest.sov_score}%).`,
          threshold: config.sov_threshold,
        }))
      }
    }

    if (config.enabled_wow && previous) {
      const drop = previous.sov_score - latest.sov_score
      if (drop >= config.wow_threshold) {
        actions.push(buildAction({
          config,
          latest,
          previous,
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
      previous &&
      latest.sov_score >= config.sov_threshold &&
      previous.sov_score < config.sov_threshold
    ) {
      actions.push(buildAction({
        config,
        latest,
        previous,
        snapshot,
        type: 'sov_recovery',
        title: `SoV Recovered — ${config.client.brand_name}`,
        message: `SoV back above ${config.sov_threshold}% threshold (current: ${latest.sov_score}%).`,
        threshold: config.sov_threshold,
      }))
    }
  }

  for (const action of actions) {
    if (action.notification) {
      try {
        await ports.upsertNotification(action.notification)
      } catch (error) {
        console.error('[alerts] notification failed:', error)
      }
    }

    if (action.email) {
      try {
        await ports.sendAlertEmail(action.email)
      } catch (error) {
        console.error('[alerts] email failed:', error)
      }
    }
  }

  return {
    processed: snapshot.configs.length,
    fired: actions.length,
  }
}

function buildAction({
  config,
  latest,
  previous,
  snapshot,
  type,
  title,
  message,
  threshold,
}: {
  config: AlertConfigWithClient
  latest: AlertWeekSnapshot
  previous?: AlertWeekSnapshot
  snapshot: AlertSnapshot
  type: AlertType
  title: string
  message: string
  threshold: number
}): AlertAction {
  const userEmail = snapshot.emailsByAccount[config.client.account_id] ?? null
  const dashboardUrl = snapshot.dashboardUrlByClient[config.client_id]

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
    email:
      config.notify_email && userEmail && dashboardUrl
        ? {
            to: userEmail,
            clientId: config.client_id,
            brandName: config.client.brand_name,
            type,
            currentSov: latest.sov_score,
            previousSov: previous?.sov_score,
            threshold,
            dashboardUrl,
          }
        : null,
  }
}
