import 'server-only'
import { db } from '@/lib/db'
import {
  firecrawlConfig,
  normalizePublicScrapeUrl,
  scrapePublicPage,
  type ScrapePublicPageInput,
} from '@/lib/integrations/firecrawl/client'
import {
  FirecrawlError,
  type FirecrawlConfig,
  type FirecrawlPageResult,
} from '@/lib/integrations/firecrawl/types'
import type { StudioFirecrawlSnapshot, StudioFirecrawlStatus } from './firecrawl-types'

/** Documented display cap; raw page bodies are never stored unbounded. */
export const STUDIO_FIRECRAWL_EXCERPT_LIMIT = 1200

export type StudioFirecrawlBrandSettings = {
  enabled: boolean
  credentialsConfigured: boolean
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
  return {
    enabled: rows[0]?.enabled === true,
    credentialsConfigured: firecrawlConfig(env) !== null,
  }
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
  credentials(): FirecrawlConfig | null
  isEnabled(accountId: string, clientId: string): Promise<boolean>
  scrape(input: ScrapePublicPageInput): Promise<FirecrawlPageResult>
}

function realDeps(): StudioFirecrawlDeps {
  return {
    credentials: () => firecrawlConfig(process.env),
    isEnabled: async (accountId, clientId) => {
      const rows = await db()`
        select enabled from studio_firecrawl_brand_settings
        where account_id = ${accountId}::uuid and client_id = ${clientId}::uuid
      `
      return rows[0]?.enabled === true
    },
    scrape: input => scrapePublicPage(input),
  }
}

const STATUS_FOR_FAILURE: Record<string, StudioFirecrawlStatus> = {
  unavailable: 'unavailable',
  auth: 'auth',
  payment: 'payment',
  rate_limit: 'rate_limit',
  invalid: 'invalid',
  misconfigured: 'misconfigured',
}

const MESSAGE_FOR_URL_REASON: Record<string, string> = {
  empty: 'firecrawl.emptyUrl',
  too_long: 'firecrawl.urlTooLong',
  not_public: 'firecrawl.publicOnly',
  invalid: 'firecrawl.invalidUrl',
}

function excerpt(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return trimmed.slice(0, STUDIO_FIRECRAWL_EXCERPT_LIMIT)
}

/**
 * At most one Firecrawl scrape per Studio turn. Credentials and the public URL
 * guard run before the per-brand switch, and only then can one vendor call run.
 */
export async function queryStudioFirecrawl(
  input: { accountId: string; clientId: string; url?: string; signal?: AbortSignal },
  overrides: Partial<StudioFirecrawlDeps> = {},
): Promise<StudioFirecrawlSnapshot> {
  const deps: StudioFirecrawlDeps = { ...realDeps(), ...overrides }
  if (!deps.credentials()) return { status: 'disconnected' }

  const check = normalizePublicScrapeUrl(input.url ?? '')
  if (!check.ok) {
    return { status: 'invalid', messageKey: MESSAGE_FOR_URL_REASON[check.reason] ?? 'firecrawl.invalidUrl' }
  }

  if (!(await deps.isEnabled(input.accountId, input.clientId))) {
    return { status: 'disabled', url: check.url }
  }

  let result: FirecrawlPageResult
  try {
    result = await deps.scrape({ url: check.url, ...(input.signal ? { signal: input.signal } : {}) })
  } catch (error) {
    const kind = error instanceof FirecrawlError ? error.kind : 'unavailable'
    return { status: STATUS_FOR_FAILURE[kind] ?? 'unavailable', url: check.url }
  }

  const body = excerpt(result.markdown ?? result.text)
  if (!body) {
    return {
      status: 'empty',
      url: result.url || check.url,
      ...(result.title ? { title: result.title } : {}),
      ...(result.contentType ? { contentType: result.contentType } : {}),
    }
  }

  return {
    status: 'ok',
    url: result.url || check.url,
    ...(result.title ? { title: result.title } : {}),
    excerpt: body,
    ...(result.contentType ? { contentType: result.contentType } : {}),
  }
}
