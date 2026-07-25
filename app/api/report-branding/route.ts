import {
  ReportServiceError,
  getAuthenticatedReportBranding,
  putAuthenticatedReportBranding,
  reportErrorResponse,
  reportJson,
} from '@/lib/reports/service'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function parseBranding(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    throw new ReportServiceError('invalid_request')
  }
  if (!isRecord(body)) throw new ReportServiceError('invalid_request')
  const allowed = ['agencyName', 'logoUrl', 'primaryColor', 'contactLabel', 'contactUrl']
  if (Object.keys(body).some(key => !allowed.includes(key)) || allowed.some(key => !Object.hasOwn(body, key))) {
    throw new ReportServiceError('invalid_request')
  }
  if (typeof body.agencyName !== 'string'
    || body.agencyName.trim().length < 1
    || body.agencyName.trim().length > 120
    || typeof body.primaryColor !== 'string'
    || (body.logoUrl !== null && typeof body.logoUrl !== 'string')
    || (body.contactLabel !== null && typeof body.contactLabel !== 'string')
    || (body.contactUrl !== null && typeof body.contactUrl !== 'string')
    || (typeof body.logoUrl === 'string' && body.logoUrl.length > 2048)
    || (typeof body.contactLabel === 'string' && body.contactLabel.trim().length > 80)
    || (typeof body.contactUrl === 'string' && body.contactUrl.length > 2048)) {
    throw new ReportServiceError('invalid_request')
  }
  return {
    agencyName: body.agencyName,
    logoUrl: body.logoUrl,
    primaryColor: body.primaryColor,
    contactLabel: body.contactLabel,
    contactUrl: body.contactUrl,
  }
}

export async function GET() {
  try {
    return reportJson(await getAuthenticatedReportBranding())
  } catch (error) {
    return reportErrorResponse(error)
  }
}

export async function PUT(req: Request) {
  try {
    return reportJson(await putAuthenticatedReportBranding(await parseBranding(req)))
  } catch (error) {
    return reportErrorResponse(error)
  }
}