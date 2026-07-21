import 'server-only'

import { createPublicUrlFetcher, type PublicUrlFetch } from '../security/public-url'
import type { ReportBrandingInput, ReportBrandingSnapshot } from './types'

export const REPORT_LOGO_MAX_BYTES = 2 * 1024 * 1024
export const REPORT_LOGO_CACHE_CONTROL = 'public, max-age=3600, stale-while-revalidate=86400' as const
const REPORT_LOGO_TIMEOUT_MS = 10_000
const ACCEPTED_LOGO_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/
const ENCODED_CONTROL_CHARACTER = /%(?:0[0-9a-f]|1[0-9a-f]|7f|8[0-9a-f]|9[0-9a-f])/i
const defaultLogoFetcher = createPublicUrlFetcher({
  maxResponseBytes: REPORT_LOGO_MAX_BYTES,
  timeoutMs: REPORT_LOGO_TIMEOUT_MS,
})

export type ReportLogo = Readonly<{
  bytes: Uint8Array
  contentType: 'image/png' | 'image/jpeg' | 'image/webp'
  etag: string | null
  lastModified: string | null
  cacheControl: typeof REPORT_LOGO_CACHE_CONTROL
}>

function plainText(value: string, field: string, maxLength: number): string {
  if (typeof value !== 'string' || CONTROL_CHARACTER.test(value)) {
    throw new Error(`${field} must be plain text`)
  }
  const normalized = value.trim()
  if (normalized.length < 1 || normalized.length > maxLength) {
    throw new Error(`${field} must be between 1 and ${maxLength} characters`)
  }
  return normalized
}

function safeUrl(value: string, field: string): URL {
  if (typeof value !== 'string' || CONTROL_CHARACTER.test(value) || ENCODED_CONTROL_CHARACTER.test(value)) {
    throw new Error(`${field} must not contain control characters`)
  }
  const normalized = value.trim()
  if (normalized.length === 0 || normalized.length > 2048) throw new Error(`${field} is invalid`)
  try {
    return new URL(normalized)
  } catch {
    throw new Error(`${field} is invalid`)
  }
}

export function normalizeReportAgencyName(value: string): string {
  return plainText(value, 'Agency name', 120)
}

export function normalizeReportPrimaryColor(value: string): string {
  if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) {
    throw new Error('Primary color must be an exact six-digit hex color')
  }
  return value.toUpperCase()
}

export function normalizeReportLogoUrl(value: string | null): string | null {
  if (value === null) return null
  const url = safeUrl(value, 'Logo URL')
  if (url.protocol !== 'https:') throw new Error('Logo URL must use HTTPS')
  if (url.username || url.password) throw new Error('Logo URL credentials are not allowed')
  return url.toString()
}

export function normalizeReportContact(
  label: string | null,
  destination: string | null,
): Readonly<{ contactLabel: string | null; contactUrl: string | null }> {
  if ((label === null) !== (destination === null)) {
    throw new Error('Contact CTA label and destination must be provided together')
  }
  if (label === null || destination === null) return { contactLabel: null, contactUrl: null }

  const contactLabel = plainText(label, 'Contact CTA label', 120)
  const url = safeUrl(destination, 'Contact CTA destination')
  if (url.protocol !== 'https:' && url.protocol !== 'mailto:') {
    throw new Error('Contact CTA destination must use HTTPS or mailto')
  }
  if (url.username || url.password) throw new Error('Contact CTA credentials are not allowed')
  if (url.protocol === 'mailto:' && url.pathname.length === 0) {
    throw new Error('Contact CTA mailto destination requires an address')
  }
  return { contactLabel, contactUrl: destination.trim() }
}

export function normalizeReportBranding(input: ReportBrandingInput): ReportBrandingSnapshot {
  const contact = normalizeReportContact(input.contactLabel, input.contactUrl)
  return {
    agencyName: normalizeReportAgencyName(input.agencyName),
    logoUrl: normalizeReportLogoUrl(input.logoUrl),
    primaryColor: normalizeReportPrimaryColor(input.primaryColor),
    ...contact,
    attribution: 'Powered by Fimmick AISO',
  }
}

export async function fetchReportLogo(
  value: string,
  options: { readonly fetcher?: PublicUrlFetch } = {},
): Promise<ReportLogo> {
  const url = safeUrl(value, 'Logo URL')
  if (url.protocol !== 'https:') throw new Error('Logo URL must use HTTPS')
  if (url.username || url.password) throw new Error('Logo URL credentials are not allowed')

  const response = await (options.fetcher ?? defaultLogoFetcher)(url, {
    method: 'GET',
    headers: {
      accept: 'image/png, image/jpeg, image/webp',
      'user-agent': 'Fimmick AISO Logo Fetcher/1.0',
    },
    credentials: 'omit',
    cache: 'no-store',
    signal: AbortSignal.timeout(REPORT_LOGO_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`Logo request failed with status ${response.status}`)

  const rawContentType = response.headers.get('content-type')
  const contentType = rawContentType?.split(';', 1)[0]?.trim().toLowerCase()
  if (!contentType || !ACCEPTED_LOGO_TYPES.has(contentType)) {
    await response.body?.cancel()
    throw new Error('Logo response has an unsupported content type')
  }

  const declaredLength = response.headers.get('content-length')
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength)
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0 || parsedLength > REPORT_LOGO_MAX_BYTES) {
      await response.body?.cancel()
      throw new Error('Logo response exceeds the 2 MiB limit')
    }
  }

  const chunks: Uint8Array[] = []
  let received = 0
  if (response.body) {
    const reader = response.body.getReader()
    for (;;) {
      const { done, value: chunk } = await reader.read()
      if (done) break
      received += chunk.byteLength
      if (received > REPORT_LOGO_MAX_BYTES) {
        await reader.cancel()
        throw new Error('Logo response exceeds the 2 MiB limit')
      }
      chunks.push(chunk)
    }
  }
  const bytes = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  const rawEtag = response.headers.get('etag')
  const etag = rawEtag && rawEtag.length <= 200 && /^(?:W\/)?"[\x21\x23-\x7e]*"$/.test(rawEtag)
    ? rawEtag
    : null
  const rawLastModified = response.headers.get('last-modified')
  const lastModifiedDate = rawLastModified && rawLastModified.length <= 64
    ? Date.parse(rawLastModified)
    : Number.NaN
  const lastModified = Number.isFinite(lastModifiedDate)
    ? new Date(lastModifiedDate).toUTCString()
    : null

  return {
    bytes,
    contentType: contentType as ReportLogo['contentType'],
    etag,
    lastModified,
    cacheControl: REPORT_LOGO_CACHE_CONTROL,
  }
}
