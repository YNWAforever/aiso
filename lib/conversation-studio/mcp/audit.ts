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
