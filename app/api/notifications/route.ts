import { getProfile } from '@/lib/auth'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  const profile = await getProfile()
  if (!profile) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const notifications = await db()`
      select * from notifications
      where account_id = ${profile.account_id}
      order by created_at desc
      limit 20
    `
    return Response.json({ notifications })
  } catch {
    return Response.json({ error: 'Notification lookup failed' }, { status: 503 })
  }
}
