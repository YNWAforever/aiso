import { authorizeProbe, validProbeSecret, readBoundedJson, ProbeBodyError } from '@/lib/readiness/runtime-auth'
import { parseProbeRequest } from '@/lib/readiness/runtime-contract'
import { runRuntimeProbe } from '@/lib/readiness/runtime'
import { createRuntimePorts } from '@/lib/readiness/runtime-adapters'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const environmentKeys = [
  'DATABASE_URL', 'NEON_AUTH_BASE_URL', 'NEON_AUTH_COOKIE_SECRET',
  'PUBLIC_SCAN_RATE_LIMIT_SECRET', 'NEXT_PUBLIC_APP_URL', 'REPORT_SHARE_SECRET',
  'OPENROUTER_API_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET',
  'STRIPE_PRICE_BASIC', 'STRIPE_PRICE_PRO', 'STRIPE_PRICE_ENTERPRISE',
  'RESEND_API_KEY', 'RESEND_FROM_EMAIL', 'RESEND_TRIAL_FROM_EMAIL', 'CRON_SECRET',
  'EXPECTED_NEON_PROJECT_ID', 'EXPECTED_NEON_BRANCH_ID', 'EXPECTED_DB_ROLE', 'EXPECTED_DB_NAME',
  'FORBIDDEN_NEON_PROJECT_IDS', 'FORBIDDEN_NEON_BRANCH_IDS', 'FORBIDDEN_DB_HOSTS',
  'VERCEL', 'VERCEL_PROJECT_ID', 'VERCEL_DEPLOYMENT_ID', 'VERCEL_GIT_COMMIT_SHA',
  'VERCEL_ENV', 'VERCEL_URL', 'READINESS_EXPECTED_TEAM_ID', 'VERCEL_AUTOMATION_BYPASS_SECRET',
] as const
const unavailable = () => Response.json({ error: 'Readiness unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
const errorResponse = (status: number, error: string) => Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } })

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.READINESS_PROBE_SECRET
  if (!validProbeSecret(secret)) return unavailable()
  if (!authorizeProbe(request, secret)) return errorResponse(401, 'Unauthorized')

  const controller = new AbortController()
  const abort = () => controller.abort()
  request.signal.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(abort, 15000)
  if (request.signal.aborted) abort()
  try {
    let input
    try { input = parseProbeRequest(await readBoundedJson(request, 16384, controller.signal)) }
    catch (error) {
      if (controller.signal.aborted || error instanceof ProbeBodyError && error.status === 503) return unavailable()
      return errorResponse(error instanceof ProbeBodyError ? error.status : 400, 'Invalid readiness request')
    }
    controller.signal.throwIfAborted()
    const env = Object.fromEntries(environmentKeys.map(key => [key, process.env[key]]))
    const ports = createRuntimePorts({ env })
    const report = await runRuntimeProbe(input, ports, controller.signal)
    return Response.json(report, { headers: { 'Cache-Control': 'no-store' } })
  } catch { return unavailable() }
  finally {
    clearTimeout(timer)
    request.signal.removeEventListener('abort', abort)
  }
}

function unsupported(): Response {
  return new Response(null, { status: 405, headers: { 'Cache-Control': 'no-store', Allow: 'POST' } })
}
export const GET = unsupported
export const HEAD = unsupported
export const PUT = unsupported
export const PATCH = unsupported
export const DELETE = unsupported
export const OPTIONS = unsupported
