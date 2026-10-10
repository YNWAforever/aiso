import { db } from '@/lib/db'
import { getProfile } from '@/lib/auth'
import { readShareOfVoice, shareOfVoiceCsv } from '@/lib/pulse/share-of-voice'

export const dynamic = 'force-dynamic'

/**
 * Share of voice for one brand: JSON by default, `?format=csv` to download.
 *
 * Signed-in and owned, no plan gate: it is a view over the same Pulse answers
 * the Pulse page already shows to every plan (load-owned-pulse has no plan
 * check either).
 */
export async function GET(req: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params
  const format = new URL(req.url).searchParams.get('format') ?? 'json'
  if (format !== 'json' && format !== 'csv') return Response.json({ error: 'Invalid format' }, { status: 400 })

  // Not wrapped: a session-store outage must surface as a 500, not a 401.
  const profile = await getProfile()
  if (!profile) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  let view
  try {
    view = await readShareOfVoice(db(), profile.account_id, clientId)
  } catch {
    // A failed lookup must never read as "not yours".
    return Response.json({ error: 'Share of voice lookup failed' }, { status: 503 })
  }
  if (!view) return Response.json({ error: 'Not found' }, { status: 404 })

  if (format === 'csv') {
    const filename = `share-of-voice-${clientId.replace(/[^a-zA-Z0-9-]/g, '')}.csv`
    // The BOM makes Excel read the file as UTF-8, so Chinese names survive.
    return new Response(`﻿${shareOfVoiceCsv(view)}`, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  }
  return Response.json({ view }, { headers: { 'Cache-Control': 'no-store' } })
}
