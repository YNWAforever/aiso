import 'server-only'
import { db } from '@/lib/db'

export type StudioMcpAuditOutcome = 'allowed' | 'denied' | 'failed'

const MAX_DETAIL = 200
const MAX_RPC_ID = 64

/** One bounded code per call; never arguments, prompts, answers or provider output. */
export function auditDetail(value: string | null): string | null {
  if (!value) return null
  return value.slice(0, MAX_DETAIL)
}

export function auditRpcId(value: unknown): string | null {
  return typeof value === 'string' || typeof value === 'number' ? String(value).slice(0, MAX_RPC_ID) : null
}

/**
 * Append-only call history for the internal MCP. Migration 106 grants the app
 * role SELECT+INSERT only, so a recorded call cannot be rewritten. A write
 * failure is thrown: the transport fails the request rather than serving data
 * while claiming the call was audited.
 */
export async function recordStudioMcpCall(input: {
  accountId: string
  clientId: string
  profileId: string
  tool: string
  outcome: StudioMcpAuditOutcome
  detail?: string | null
  rpcId?: string | number | null
}): Promise<void> {
  const sql = db()
  await sql`
    insert into studio_mcp_calls (account_id, client_id, profile_id, tool, outcome, detail, rpc_id)
    values (${input.accountId}::uuid, ${input.clientId}::uuid, ${input.profileId}::uuid,
      ${input.tool.slice(0, 64)}, ${input.outcome}, ${auditDetail(input.detail ?? null)}, ${auditRpcId(input.rpcId ?? null)})
  `
}

/**
 * Bounded per-token / per-brand call rate (slice 3). The transport had none, so
 * one valid one-hour token could read the whole brand in a loop. The audit table
 * is insert-only and already records every call; counting its last minute is the
 * same data the operator can see, with no new table, counter or migration.
 *
 * The count includes denied and failed calls, so a caller cannot escape the
 * bound by asking for unknown tools.
 */
export const STUDIO_MCP_CALLS_PER_MINUTE = 30

export async function countStudioMcpCallsLastMinute(input: {
  accountId: string
  clientId: string
  profileId: string
}): Promise<number> {
  const sql = db()
  const rows = await sql`
    select count(*)::int as n
    from studio_mcp_calls
    where account_id = ${input.accountId}::uuid
      and client_id = ${input.clientId}::uuid
      and profile_id = ${input.profileId}::uuid
      and created_at > now() - interval '60 seconds'
  `
  return Number(rows[0]?.n ?? 0)
}
