import { NextRequest, NextResponse } from 'next/server'
import { getProfile } from '@/lib/auth'
import { redactSecrets } from '@/lib/security/redact-secrets'
import { loadOwnedWorkspace, workspaceOverview } from '@/lib/workspace/load-owned-workspace'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const { clientId } = await params
  const profile = await getProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const workspace = await loadOwnedWorkspace({ clientId, profile })
    if (!workspace) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(workspaceOverview(workspace))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[overview] query failed:', redactSecrets(message))
    return NextResponse.json({ error: 'Failed to load overview' }, { status: 500 })
  }
}
