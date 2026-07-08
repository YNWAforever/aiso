import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const { scanId, email: rawEmail } = body as { scanId?: string; email?: string }

  if (!scanId || typeof scanId !== 'string') {
    return NextResponse.json({ error: 'Missing scanId' }, { status: 400 })
  }

  // Normalise before validation so trailing/leading whitespace is handled gracefully
  const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : ''
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Invalid email' }, { status: 400 })
  }

  try {
    await db()`update scans set lead_email = ${email} where id = ${scanId}`
  } catch (error) {
    console.error('[scan/lead] db error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
