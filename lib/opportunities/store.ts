import 'server-only'
import { createHash } from 'node:crypto'
import { db } from '@/lib/db'
import { projectObservation } from '@/lib/observations/schema'
import type { PulseSourceRow } from '@/lib/observations/types'
import { readScanEvidence } from '@/lib/scan-evidence'
import type { OpportunityResponse, OpportunityWindow, SourceEvidence } from '@/lib/opportunities/types'

export type PersistedPulseInput = PulseSourceRow & { client_id: string; has_answer: boolean }
export interface PersistedScanInput {
  id: string
  client_id: string
  account_id: string
  created_at: string | null
  envelope: unknown
}
/** SERVER ONLY: exact persisted values for Task4's guarded INSERT equality, never a DTO. */
export type EvidenceVersionToken =
  | { kind: 'pulse-metric'; accountId: string; row: PersistedPulseInput }
  | { kind: 'scan-check'; accountId: string; row: PersistedScanInput }
export interface SourceWindow {
  window: OpportunityWindow
  sourceStates: OpportunityResponse['sourceStates']
  sources: SourceEvidence[]
  evidenceVersions: EvidenceVersionToken[]
}

/** Reusable projection after an owned exact-row read; keeps timestamps and nullable answer intact. */
export function projectPulseOpportunityInput(accountId: string, row: PersistedPulseInput) {
  const input: PersistedPulseInput = {
    id: row.id, client_id: row.client_id, prompt_id: row.prompt_id, question: row.question,
    platform: row.platform, scan_week: row.scan_week, created_at: row.created_at,
    raw_answer: row.raw_answer, brand_mentioned: row.brand_mentioned, has_answer: row.has_answer,
  }
  const source: SourceEvidence = {
    kind: 'pulse-metric', observation: projectObservation(input, null),
    answerDigest: createHash('sha256').update(JSON.stringify(input.raw_answer), 'utf8').digest('hex'),
  }
  const version: EvidenceVersionToken = { kind: 'pulse-metric', accountId, row: input }
  return { source, version }
}

/** Validates the selected envelope; invalid newest rows must not fall back to older scans. */
export function projectScanOpportunityInput(accountId: string, row: PersistedScanInput) {
  const envelope = readScanEvidence(row.envelope)
  if (envelope === null) return null
  const source: SourceEvidence = { kind: 'scan-check', scanId: row.id, recordedAt: row.created_at, envelope }
  const version: EvidenceVersionToken = {
    kind: 'scan-check', accountId,
    row: { id: row.id, client_id: row.client_id, account_id: row.account_id, created_at: row.created_at, envelope: row.envelope },
  }
  return { source, version }
}

export async function loadOwnedOpportunitySources(accountId: string, clientId: string): Promise<SourceWindow | null> {
  const sql = db()
  const owned = await sql`select id from clients where id = ${clientId} and account_id = ${accountId}`
  if (!owned.length) return null
  const result: SourceWindow = {
    window: { pulseWeek: null, pulseLimit: 200, pulseTruncated: false, scanId: null },
    sourceStates: { pulse: 'unavailable', scan: 'unavailable' }, sources: [], evidenceVersions: [],
  }
  const [pulse, scan] = await Promise.allSettled([
    sql`
      select m.id, m.client_id, m.prompt_id, m.question, m.platform,
        m.scan_week::text as scan_week,
        to_char(m.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at,
        m.raw_answer, m.brand_mentioned, coalesce(m.raw_answer ~ '[^[:space:]]', false) as has_answer
      from pulse_metrics m join clients c on c.id = m.client_id
      where c.id = ${clientId} and c.account_id = ${accountId}
        and m.scan_week = (select max(p.scan_week) from pulse_metrics p
          join clients owner on owner.id = p.client_id
          where owner.id = ${clientId} and owner.account_id = ${accountId})
      order by m.created_at desc nulls last, m.id desc limit 201
    `,
    sql`
      select s.id, s.client_id, s.account_id,
        to_char(s.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at,
        s.results -> 'evidence' as envelope
      from scans s join clients c on c.id = s.client_id and c.account_id = s.account_id
      where s.client_id = ${clientId} and s.account_id = ${accountId}
      order by s.created_at desc nulls last, s.id desc limit 1
    `,
  ])
  if (pulse.status === 'fulfilled') {
    try {
      const rows = pulse.value as PersistedPulseInput[]
      const projected = rows.slice(0, 200).map(row => projectPulseOpportunityInput(accountId, row))
      result.window.pulseWeek = rows[0]?.scan_week ?? null
      result.window.pulseTruncated = rows.length > 200
      result.sourceStates.pulse = rows.length ? 'ok' : 'empty'
      result.sources.push(...projected.map(item => item.source))
      result.evidenceVersions.push(...projected.map(item => item.version))
    } catch { /* A malformed source is unavailable, never empty. */ }
  }
  if (scan.status === 'fulfilled') {
    const row = scan.value[0] as PersistedScanInput | undefined
    if (!row) result.sourceStates.scan = 'empty'
    else {
      result.window.scanId = row.id
      const projected = projectScanOpportunityInput(accountId, row)
      if (projected) {
        result.sourceStates.scan = 'ok'
        result.sources.push(projected.source)
        result.evidenceVersions.push(projected.version)
      }
    }
  }
  return result
}

export async function loadSavedDraftMapping(accountId: string, clientId: string, keys: string[]): Promise<Map<string, string>> {
  if (!keys.length) return new Map()
  const sql = db()
  const rows = await sql`
    select d.id, d.opportunity_key from evidence_work_items d
    join clients c on c.id = d.client_id and c.account_id = d.account_id
    where d.account_id = ${accountId} and d.client_id = ${clientId}
      and d.opportunity_key = any(${keys}::text[])
    order by d.opportunity_key limit 240
  ` as { id: string; opportunity_key: string }[]
  const requested = new Set(keys)
  return new Map(rows.filter(row => requested.has(row.opportunity_key)).map(row => [row.opportunity_key, row.id]))
}
