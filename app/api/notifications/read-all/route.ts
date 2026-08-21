import { getProfile } from '@/lib/auth'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function PUT() {
  const profile = await getProfile()
  if (!profile) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await db()`
      update notifications
      set read = ${true}
      where account_id = ${profile.account_id} and read = ${false}
    `
    return Response.json({ ok: true })
  } catch {
    return Response.json({ error: 'Failed to mark notifications read' }, { status: 500 })
  }
}
