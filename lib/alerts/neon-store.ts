import type { NeonQueryFunction } from '@neondatabase/serverless'
import {
  type AlertConfigWithClient,
  type AlertEmailDeliveryKey,
  type AlertEvaluationPorts,
  type AlertNotificationInput,
  type AlertSnapshot,
  type AlertWeekSnapshot,
} from '@/lib/alerts/evaluate'
import { isoDate } from '@/lib/iso-date'

const PAGE_SIZE = 1000
type Sql = NeonQueryFunction<false, false>

type AlertConfigRow = {
  id: string
  client_id: string
  enabled_sov: boolean
  sov_threshold: number | string
  enabled_wow: boolean
  wow_threshold: number | string
  notify_email: boolean
  notify_inapp: boolean
  created_at: string | null
  updated_at: string | null
  joined_client_id: string
  joined_brand_name: string
  joined_account_id: string
}

type WeeklyRow = {
  client_id: string
  scan_week: string | Date
  sov_score: number | string | null
}

type EmailRow = {
  account_id: string
  email: string | null
}

export type NeonAlertStore = Pick<
  AlertEvaluationPorts,
  'loadSnapshot' | 'upsertNotification' | 'claimEmailDelivery' | 'releaseEmailDelivery'
>

export function createNeonAlertStore(sql: Sql): NeonAlertStore {
  return {
    loadSnapshot: () => loadSnapshot(sql),
    upsertNotification: notification => upsertNotification(sql, notification),
    claimEmailDelivery: key => claimEmailDelivery(sql, key),
    releaseEmailDelivery: key => releaseEmailDelivery(sql, key),
  }
}

async function loadSnapshot(sql: Sql): Promise<AlertSnapshot> {
  const configs = await loadConfigs(sql)
  if (!configs.length) {
    return {
      configs: [],
      weeksByClient: {},
      emailsByAccount: {},
      dashboardUrlByClient: {},
    }
  }

  const clientIds = [...new Set(configs.map(config => config.client_id))]
  const accountIds = [...new Set(configs.map(config => config.client.account_id))]
  const [weeklyRows, emailRows] = await Promise.all([
    loadWeeklyRows(sql, clientIds),
    loadEmailRows(sql, accountIds),
  ])

  const weeksByClient: Record<string, AlertWeekSnapshot[]> = {}
  for (const row of weeklyRows) {
    const week = {
      client_id: row.client_id,
      // This value is the scan_week half of both dedup keys. The '' fallback
      // is unreachable in practice -- pulse_weekly_summary.scan_week is
      // `date not null` -- and deliberate: a missing value should degrade to
      // a counted failure downstream, not a wrong-but-plausible date string.
      scan_week: isoDate(row.scan_week, ''),
      sov_score: row.sov_score === null ? null : Number(row.sov_score),
    }
    weeksByClient[row.client_id] = [...(weeksByClient[row.client_id] ?? []), week]
  }

  return {
    configs,
    weeksByClient,
    emailsByAccount: Object.fromEntries(
      emailRows.map(row => [row.account_id, row.email]),
    ),
    dashboardUrlByClient: Object.fromEntries(
      configs.map(config => [
        config.client_id,
        `${process.env.NEXT_PUBLIC_APP_URL}/en/dashboard/${config.client_id}`,
      ]),
    ),
  }
}

async function loadConfigs(sql: Sql): Promise<AlertConfigWithClient[]> {
  const configs: AlertConfigWithClient[] = []
  let lastId: string | null = null

  for (;;) {
    const rows = (await sql`
      SELECT
        ac.id,
        ac.client_id,
        ac.enabled_sov,
        ac.sov_threshold,
        ac.enabled_wow,
        ac.wow_threshold,
        ac.notify_email,
        ac.notify_inapp,
        ac.created_at,
        ac.updated_at,
        c.id AS joined_client_id,
        c.brand_name AS joined_brand_name,
        c.account_id AS joined_account_id
      FROM public.alert_configs AS ac
      INNER JOIN public.clients AS c ON c.id = ac.client_id
      WHERE (ac.enabled_sov = TRUE OR ac.enabled_wow = TRUE)
        AND (${lastId === null} OR ac.id > ${lastId})
      ORDER BY ac.id ASC
      LIMIT ${PAGE_SIZE}
    `) as AlertConfigRow[]
    if (!rows.length) break

    for (const row of rows) {
      configs.push({
        id: row.id,
        client_id: row.client_id,
        enabled_sov: Boolean(row.enabled_sov),
        sov_threshold: Number(row.sov_threshold),
        enabled_wow: Boolean(row.enabled_wow),
        wow_threshold: Number(row.wow_threshold),
        notify_email: Boolean(row.notify_email),
        notify_inapp: Boolean(row.notify_inapp),
        created_at: row.created_at ?? undefined,
        updated_at: row.updated_at ?? undefined,
        client: {
          id: row.joined_client_id,
          brand_name: row.joined_brand_name,
          account_id: row.joined_account_id,
        },
      })
    }
    lastId = rows[rows.length - 1].id
  }

  return configs
}

async function loadWeeklyRows(sql: Sql, clientIds: string[]): Promise<WeeklyRow[]> {
  return (await sql`
    WITH latest_distinct_weeks AS (
      SELECT DISTINCT ON (summary.client_id, summary.scan_week)
        summary.client_id,
        summary.scan_week,
        summary.sov_score
      FROM public.pulse_weekly_summary AS summary
      WHERE summary.platform IS NULL
        AND summary.client_id = ANY(${clientIds}::uuid[])
      ORDER BY
        summary.client_id,
        summary.scan_week DESC,
        summary.created_at DESC NULLS LAST,
        summary.id DESC
    ), ranked AS (
      SELECT
        latest_distinct_weeks.client_id,
        latest_distinct_weeks.scan_week,
        latest_distinct_weeks.sov_score,
        row_number() OVER (
          PARTITION BY latest_distinct_weeks.client_id
          ORDER BY latest_distinct_weeks.scan_week DESC
        ) AS row_number
      FROM latest_distinct_weeks
    )
    SELECT client_id, scan_week, sov_score
    FROM ranked
    WHERE row_number <= 2
    ORDER BY client_id, row_number ASC
  `) as WeeklyRow[]
}

async function loadEmailRows(sql: Sql, accountIds: string[]): Promise<EmailRow[]> {
  return (await sql`
    SELECT DISTINCT ON (p.account_id)
      p.account_id,
      u.email
    FROM public.profiles AS p
    LEFT JOIN neon_auth."user" AS u ON u.id = p.id
    WHERE p.account_id = ANY(${accountIds}::uuid[])
    ORDER BY p.account_id ASC, p.id ASC
  `) as EmailRow[]
}

async function upsertNotification(sql: Sql, notification: AlertNotificationInput) {
  await sql`
    INSERT INTO public.notifications (
      account_id,
      client_id,
      type,
      title,
      message,
      read,
      scan_week
    ) VALUES (
      ${notification.account_id},
      ${notification.client_id},
      ${notification.type},
      ${notification.title},
      ${notification.message},
      ${notification.read},
      ${notification.scan_week}
    )
    ON CONFLICT (client_id, type, scan_week) DO NOTHING
  `
}

/**
 * Reserve this week's email for one client and alert type.
 *
 * RETURNING on a single-table insert is safe. The rule against `returning *`
 * applies to statements that join — the HTTP driver builds rows with
 * Object.fromEntries, so duplicate column names across joined tables silently
 * overwrite, last wins. There is no join here and the column is named.
 */
async function claimEmailDelivery(sql: Sql, key: AlertEmailDeliveryKey): Promise<boolean> {
  const rows = (await sql`
    INSERT INTO public.alert_email_deliveries (client_id, type, scan_week, recipient)
    VALUES (${key.client_id}, ${key.type}, ${key.scan_week}, ${key.recipient})
    ON CONFLICT (client_id, type, scan_week) DO NOTHING
    RETURNING id
  `) as Array<{ id: string }>

  return rows.length > 0
}

/**
 * Hand a claim back after a failed send so a later run retries this week.
 *
 * Deliberately does not filter on recipient: (client_id, type, scan_week) is
 * the whole natural key, and recipient is only insert payload. Adding
 * `AND recipient = ...` here would make the delete a no-op whenever the
 * account's email changed between the claim and this release, permanently
 * stranding the claimed row — no later run could re-claim it, so no email
 * would go out for that client/type for the rest of the week.
 */
async function releaseEmailDelivery(sql: Sql, key: AlertEmailDeliveryKey): Promise<void> {
  await sql`
    DELETE FROM public.alert_email_deliveries
    WHERE client_id = ${key.client_id}
      AND type = ${key.type}
      AND scan_week = ${key.scan_week}
  `
}
