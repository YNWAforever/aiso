import 'server-only'

import { createHmac, timingSafeEqual } from 'node:crypto'

import { REPORT_LOCALES, type ReportLocale } from './types'

type ShareInput = {
  readonly slug: string
  readonly shareVersion: number
}

const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/

function shareSecret(): string {
  const secret = process.env.REPORT_SHARE_SECRET
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('REPORT_SHARE_SECRET must contain at least 32 random characters')
  }
  return secret
}

function canonicalShareInput(input: ShareInput): string {
  if (!Number.isInteger(input.shareVersion) || input.shareVersion <= 0) {
    throw new Error('Share version must be a positive integer')
  }
  if (typeof input.slug !== 'string' || input.slug.length === 0) {
    throw new Error('Report slug is required')
  }
  return `fimmick-report:v1:${input.slug}:${input.shareVersion}`
}

function shareDigest(input: ShareInput): Buffer {
  return createHmac('sha256', shareSecret()).update(canonicalShareInput(input)).digest()
}

export function signReportShare(input: ShareInput): string {
  return shareDigest(input).toString('base64url')
}

export function verifyReportShare(input: ShareInput & { readonly signature: string }): boolean {
  const secret = shareSecret()
  if (!Number.isInteger(input.shareVersion) || input.shareVersion <= 0) return false
  if (typeof input.slug !== 'string' || input.slug.length === 0) return false
  if (typeof input.signature !== 'string' || !SIGNATURE_PATTERN.test(input.signature)) return false

  const received = Buffer.from(input.signature, 'base64url')
  if (received.length !== 32 || received.toString('base64url') !== input.signature) return false
  const expected = createHmac('sha256', secret).update(canonicalShareInput(input)).digest()
  return received.length === expected.length && timingSafeEqual(received, expected)
}

export function buildReportShareUrl(input: ShareInput & {
  readonly origin: string
  readonly locale: ReportLocale
}): string {
  if (!REPORT_LOCALES.includes(input.locale)) throw new Error('Unsupported report locale')
  const url = new URL(input.origin)
  url.pathname = `/${input.locale}/reports/${encodeURIComponent(input.slug)}`
  url.search = ''
  url.hash = ''
  url.searchParams.set('version', String(input.shareVersion))
  url.searchParams.set('signature', signReportShare(input))
  return url.toString()
}
