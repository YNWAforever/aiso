import { NextResponse } from 'next/server'
import { requireApiAdmin } from '@/lib/admin-guard'
import { retryFixPackUsage } from '@/lib/billing/usage'

type Context = { params: Promise<{ eventId: string }> }

/**
 * Retry one failed (or stuck pending) fix-pack meter event. The row id is the
 * admin's handle; the identifier and the 24-hour window live in
 * lib/billing/usage.ts, so this route cannot cause a second charge.
 */
export async function POST(_request: Request, context: Context): Promise<Response> {
  const admin = await requireApiAdmin()
  if (!admin.ok) return admin.response

  const { eventId } = await context.params
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(eventId)) {
    return NextResponse.json({ error: 'Invalid usage id' }, { status: 400 })
  }

  let outcome
  try {
    outcome = await retryFixPackUsage(eventId)
  } catch (error) {
    // A failed retry write must not look like a successful retry.
    console.error('[billing] usage retry failed:', error instanceof Error ? error.message : 'unknown error')
    return NextResponse.json({ error: 'Billing retry failed' }, { status: 500 })
  }

  switch (outcome.status) {
    case 'reported':
      return NextResponse.json({ ok: true, state: 'reported' })
    case 'failed':
      return NextResponse.json({ error: 'Meter event still failing' }, { status: 502 })
    case 'not_found':
      return NextResponse.json({ error: 'Usage record not found' }, { status: 404 })
    case 'not_retryable':
      return NextResponse.json({ error: 'Usage record is not retryable' }, { status: 409 })
    case 'retry_window_elapsed':
      return NextResponse.json(
        { error: 'Usage record is older than the 24-hour retry window' },
        { status: 409 },
      )
    case 'attempts_exhausted':
      return NextResponse.json({ error: 'Usage record has no attempts left' }, { status: 409 })
  }
}
