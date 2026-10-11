import { NextRequest, NextResponse } from 'next/server'
import { requireApiAdmin } from '@/lib/admin-guard'
import { parseDirectoryQuery } from '@/lib/admin/directory-schema'
import { readAdminDirectory } from '@/lib/admin/directory'
export const dynamic = 'force-dynamic'
export async function GET(request: NextRequest) {
  const access = await requireApiAdmin()
  if (!access.ok) return access.response
  let query: ReturnType<typeof parseDirectoryQuery>
  try { query = parseDirectoryQuery(request.nextUrl.searchParams) }
  catch { return NextResponse.json({ error: 'INVALID_DIRECTORY_QUERY' }, { status: 400 }) }
  try {
    const result = await readAdminDirectory(query)
    // Access metadata only. Do not log names, email, search terms or answer content.
    console.info({ event: 'admin_directory_read', actorId: access.profile.id, view: query.view, accountId: query.accountId, page: query.page, rows: result.rows.length })
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    console.error({ event: 'admin_directory_unavailable', view: query.view })
    return NextResponse.json({ error: 'DIRECTORY_UNAVAILABLE' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
}
