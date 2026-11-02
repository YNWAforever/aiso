import 'server-only'
import { lookup as nodeLookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { db } from '@/lib/db'
import { isPublicAddress, type ResolvedAddress } from '@/lib/security/public-url'
import { firecrawlConfig, scrapePublicPage } from '@/lib/integrations/firecrawl/client'
import { FirecrawlError, type FirecrawlConfig, type ScrapePublicPageInput, type ScrapedPage } from '@/lib/integrations/firecrawl/types'
import { FIRECRAWL_URL_MAX } from './firecrawl-url'
import type { StudioFirecrawlSnapshot, StudioFirecrawlStatus } from './firecrawl-types'

/** Engineering guards (not spend numbers); documented in docs/ux/conversation-studio-stage-6f.md. */
export const FIRECRAWL_EXCERPT_MAX = 1200
export const FIRECRAWL_TITLE_MAX = 300
export const FIRECRAWL_LOOKUP_TIMEOUT_MS = 3_000

export type StudioFirecrawlBrandSettings = {
  enabled: boolean
  keyConfigured: boolean
}

export async function loadStudioFirecrawlBrandSettings(
  accountId: string,
  clientId: string,
  env: Record<string, string | undefined> = process.env,
): Promise<StudioFirecrawlBrandSettings> {
  const rows = await db()`
    select enabled from studio_firecrawl_brand_settings
    where account_id = ${accountId}::uuid and client_id = ${clientId}::uuid
  `
  return { enabled: rows[0]?.enabled === true, keyConfigured: firecrawlConfig(env) !== null }
}

export async function setStudioFirecrawlBrandEnabled(input: {
  accountId: string
  clientId: string
  enabled: boolean
  updatedBy: string
}): Promise<void> {
  await db()`
    insert into studio_firecrawl_brand_settings (account_id, client_id, enabled, updated_by, updated_at)
    values (${input.accountId}::uuid, ${input.clientId}::uuid, ${input.enabled}, ${input.updatedBy}::uuid, now())
    on conflict (client_id) do update
    set enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = now()
  `
}

export type StudioFirecrawlDeps = {
  config(): FirecrawlConfig | null
  isEnabled(accountId: string, clientId: string): Promise<boolean>
  lookup(hostname: string): Promise<ReadonlyArray<ResolvedAddress>>
  scrape(input: ScrapePublicPageInput): Promise<ScrapedPage>
}

async function lookupWithDeadline(hostname: string): Promise<ReadonlyArray<ResolvedAddress>> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('LOOKUP_TIMEOUT')), FIRECRAWL_LOOKUP_TIMEOUT_MS)
  })
  try {
    const answers = await Promise.race([nodeLookup(hostname, { all: true, verbatim: true }), deadline])
    return answers.map(answer => ({ address: answer.address, family: answer.family as 4 | 6 }))
  } finally {
    clearTimeout(timer)
  }
}

function realDeps(): StudioFirecrawlDeps {
  return {
    config: () => firecrawlConfig(process.env),
    isEnabled: async (accountId, clientId) => {
      const rows = await db()`
        select enabled from studio_firecrawl_brand_settings
        where account_id = ${accountId}::uuid and client_id = ${clientId}::uuid
      `
      return rows[0]?.enabled === true
    },
    lookup: lookupWithDeadline,
    scrape: input => scrapePublicPage(input),
  }
}

type ParsedTarget = { ok: true; url: URL; hostname: string } | { ok: false; messageKey: string }

/** Syntax-level refusal: protocol, credentials, local hostnames and non-public IP literals. */
function parseTarget(raw: string): ParsedTarget {
  if (!raw) return { ok: false, messageKey: 'firecrawl.noUrl' }
  if (raw.length > FIRECRAWL_URL_MAX) return { ok: false, messageKey: 'firecrawl.urlTooLong' }
  let url: URL
  try { url = new URL(raw) } catch { return { ok: false, messageKey: 'firecrawl.urlNotPublic' } }
  if (url.href.length > FIRECRAWL_URL_MAX) return { ok: false, messageKey: 'firecrawl.urlTooLong' }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, messageKey: 'firecrawl.urlNotPublic' }
  if (url.username || url.password) return { ok: false, messageKey: 'firecrawl.urlNotPublic' }
  const bare = url.hostname.startsWith('[') && url.hostname.endsWith(']') ? url.hostname.slice(1, -1) : url.hostname
  const hostname = bare.toLowerCase().replace(/\.$/, '')
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost')) {
    return { ok: false, messageKey: 'firecrawl.urlNotPublic' }
  }
  if (isIP(hostname) && !isPublicAddress(hostname)) return { ok: false, messageKey: 'firecrawl.urlNotPublic' }
  return { ok: true, url, hostname }
}

function truncate(value: string, max: number): string {
  const chars = Array.from(value)
  return chars.length > max ? `${chars.slice(0, max).join('').trimEnd()}…` : value
}

/** Markdown main content reduced to a bounded, display-only excerpt. */
export function boundedExcerpt(markdown: string | undefined): string | undefined {
  if (typeof markdown !== 'string') return undefined
  const cleaned = markdown
    .replace(/\r\n?/g, '\n')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return cleaned ? truncate(cleaned, FIRECRAWL_EXCERPT_MAX) : undefined
}

const STATUS_FOR_FAILURE: Record<string, StudioFirecrawlStatus> = {
  unavailable: 'unavailable',
  auth: 'auth',
  payment: 'payment',
  rate_limit: 'rate_limit',
  invalid: 'invalid',
  misconfigured: 'misconfigured',
}

/**
 * At most one Firecrawl single-page scrape for one public URL. Key, URL syntax,
 * the per-brand switch and DNS publicness are all checked before the vendor
 * call; there is no retry after it.
 */
export async function queryStudioFirecrawl(
  input: { accountId: string; clientId: string; url?: string },
  overrides: Partial<StudioFirecrawlDeps> = {},
): Promise<StudioFirecrawlSnapshot> {
  const deps: StudioFirecrawlDeps = { ...realDeps(), ...overrides }
  if (!deps.config()) return { status: 'disconnected', messageKey: 'firecrawl.disconnected' }

  const target = parseTarget(typeof input.url === 'string' ? input.url.trim() : '')
  if (!target.ok) return { status: 'invalid', messageKey: target.messageKey }
  const url = target.url.href

  if (!(await deps.isEnabled(input.accountId, input.clientId))) {
    return { status: 'disabled', url, messageKey: 'firecrawl.disabled' }
  }

  if (!isIP(target.hostname)) {
    let answers: ReadonlyArray<ResolvedAddress>
    try {
      answers = await deps.lookup(target.hostname)
    } catch {
      return { status: 'invalid', url, messageKey: 'firecrawl.urlUnresolved' }
    }
    if (!answers.length || answers.some(answer => !isPublicAddress(answer.address))) {
      return { status: 'invalid', url, messageKey: 'firecrawl.urlNotPublic' }
    }
  }

  let page: ScrapedPage
  try {
    page = await deps.scrape({ url })
  } catch (error) {
    const kind = error instanceof FirecrawlError ? error.kind : 'unavailable'
    const status = STATUS_FOR_FAILURE[kind] ?? 'unavailable'
    return { status, url, messageKey: `firecrawl.${status}` }
  }

  const shownUrl = page.url ?? url
  const contentType = page.contentType ? { contentType: page.contentType } : {}
  if (page.pageStatus !== undefined && page.pageStatus >= 400) {
    return { status: 'empty', url: shownUrl, ...contentType, messageKey: 'firecrawl.pageError' }
  }
  const title = page.title ? truncate(page.title, FIRECRAWL_TITLE_MAX) : undefined
  const excerpt = boundedExcerpt(page.markdown)
  if (!excerpt) {
    return { status: 'empty', url: shownUrl, ...(title ? { title } : {}), ...contentType, messageKey: 'firecrawl.empty' }
  }
  return { status: 'ok', url: shownUrl, ...(title ? { title } : {}), excerpt, ...contentType }
}
