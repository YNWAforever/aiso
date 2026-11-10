import { authorizeStudioBrand } from '@/lib/conversation-studio/threads'
import { isStudioMcpConfigured, mintStudioMcpToken } from '@/lib/conversation-studio/mcp/token'
import { isStudioMcpEnabled } from '@/lib/flags'

const HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: HEADERS })

/**
 * Mints the internal MCP bearer token from the member's own session. The token
 * only names the member and one brand; permissions are re-read from the
 * database by the transport on every call. MCP must be enabled for this brand,
 * and the token minting secret must be configured — otherwise the route says so
 * rather than issuing a token that cannot work.
 */
export async function POST(_request: Request, context: RouteContext<'/api/dashboard/clients/[clientId]/studio/mcp-token'>) {
  const { clientId } = await context.params
  if (!isStudioMcpEnabled(clientId)) return json({ error: 'NOT_FOUND' }, 404)
  if (!isStudioMcpConfigured()) return json({ error: 'STUDIO_MCP_UNCONFIGURED' }, 503)
  try {
    const access = await authorizeStudioBrand(clientId)
    if (access instanceof Response) return access
    const { token, expiresAt } = mintStudioMcpToken({ accountId: access.accountId, clientId, profileId: access.profileId })
    return json({ token, expiresAt, endpoint: '/api/mcp/studio' })
  } catch (error) {
    console.error('[studio-mcp] token mint failed:', error)
    return json({ error: 'STUDIO_MCP_UNAVAILABLE' }, 503)
  }
}
