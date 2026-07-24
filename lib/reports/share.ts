import 'server-only'

import { createHmac, timingSafeEqual } from 'node:crypto'

import { REPORT_LOCALES, type ReportLocale } from './types'

type ShareInput = {
  readonly slug: string
  readonly shareVersion: number
}

const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/
const REPORT_SLUG_PATTERN = /^[A-Za-z0-9_-]{32}$/

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
  if (typeof input.slug !== 'string' || !REPORT_SLUG_PATTERN.test(input.slug)) {
    throw new Error('Report slug must be 32 base64url characters')
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
  if (typeof input.slug !== 'string' || !REPORT_SLUG_PATTERN.test(input.slug)) return false
  if (typeof input.signature !== 'string' || !SIGNATURE_PATTERN.test(input.signature)) return false

  const received = Buffer.from(input.signature, 'base64url')
  if (received.length !== 32 || received.toString('base64url') !== input.signature) return false
  const expected = createHmac('sha256', secret).update(canonicalShareInput(input)).digest()
  return received.length === expected.length && timingSafeEqual(received, expected)
}

function validatedReportOrigin(value: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('Report origin must be a credential-free HTTPS origin')
  }
  if (
    url.protocol !== 'https:'
    || url.origin === 'null'
    || url.username
    || url.password
    || url.pathname !== '/'
    || url.search
    || url.hash
    || /[\\\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error('Report origin must be a credential-free HTTPS origin')
  }
  return url
}

export function prepareReportShareUrl(origin: string): (input: ShareInput & { readonly locale: ReportLocale }) => string {
  const validatedOrigin = validatedReportOrigin(origin)
  const secret = shareSecret()
  return input => {
    if (!REPORT_LOCALES.includes(input.locale)) throw new Error('Unsupported report locale')
    const url = new URL(validatedOrigin)
    url.pathname = `/${input.locale}/r/${encodeURIComponent(input.slug)}`
    url.search = ''
    url.hash = ''
    url.searchParams.set('v', String(input.shareVersion))
    url.searchParams.set(
      's',
      createHmac('sha256', secret).update(canonicalShareInput(input)).digest('base64url'),
    )
    return url.toString()
  }
}

export function buildReportShareUrl(input: ShareInput & {
  readonly origin: string
  readonly locale: ReportLocale
}): string {
  return prepareReportShareUrl(input.origin)(input)
}
