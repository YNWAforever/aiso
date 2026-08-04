import {
  ReportServiceError,
  createAuthenticatedClientReport,
  listAuthenticatedClientReports,
  reportErrorResponse,
  reportJson,
} from '@/lib/reports/service'
import type { ReportLocale } from '@/lib/reports/types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function identifier(value: unknown): string {
  if (typeof value !== 'string' || !CANONICAL_UUID.test(value)) {
    throw new ReportServiceError('invalid_request')
  }
  return value
}

function locale(value: unknown): ReportLocale {
  if (value !== 'en' && value !== 'zh-HK') throw new ReportServiceError('invalid_request')
  return value
}

function optionalSummary(value: unknown, present: boolean): string | undefined {
  if (!present) return undefined
  if (typeof value !== 'string'
    || value.trim().length < 40
    || value.trim().length > 1200
    || /[\u0000-\u001f\u007f-\u009f]/.test(value)) throw new ReportServiceError('invalid_request')
  return value
}

async function parseCreate(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    throw new ReportServiceError('invalid_request')
  }
  if (!isRecord(body)) throw new ReportServiceError('invalid_request')
  const allowed = ['scanId', 'locale', 'executiveSummary']
  if (Object.keys(body).some(key => !allowed.includes(key))
    || !Object.hasOwn(body, 'scanId')
    || !Object.hasOwn(body, 'locale')) throw new ReportServiceError('invalid_request')
  return {
    scanId: identifier(body.scanId),
    locale: locale(body.locale),
    executiveSummary: optionalSummary(body.executiveSummary, Object.hasOwn(body, 'executiveSummary')),
  }
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ clientId: string }> },
) {
  try {
    const { clientId } = await ctx.params
    return reportJson(await listAuthenticatedClientReports(identifier(clientId)))
  } catch (error) {
    return reportErrorResponse(error)
  }
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ clientId: string }> },
) {
  try {
    const { clientId } = await ctx.params
    const body = await parseCreate(req)
    const result = await createAuthenticatedClientReport({ clientId: identifier(clientId), ...body })
    return reportJson(result, 201)
  } catch (error) {
    return reportErrorResponse(error)
  }
}
