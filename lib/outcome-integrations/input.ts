import { normalizeBrandDomain } from '@/lib/integrations/search-console/binding'

export class OutcomeError extends Error {
  constructor(readonly code: string, readonly status = 400) { super(code); this.name = 'OutcomeError' }
}
function invalid(): never { throw new OutcomeError('INVALID_OUTCOME_INPUT') }
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) invalid()
  return value as Record<string, unknown>
}
export function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f]/.test(value)) invalid()
  return value.trim().normalize('NFC')
}
export function identifier(value: unknown): string {
  const id = text(value, 128)
  if (!/^[a-zA-Z0-9:_-]{8,128}$/.test(id)) invalid()
  return id
}
export function uuid(value: unknown): string { const id = text(value, 36); if (!UUID.test(id)) invalid(); return id.toLowerCase() }
function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 1_000_000_000) invalid()
  return value
}
export function canonicalOutcomeUrl(value: unknown, domain: string): string {
  let url: URL
  try { url = new URL(text(value, 2048)) } catch { return invalid() }
  const host = url.hostname.toLowerCase()
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port || url.search || url.hash
    || !host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':') || /\.(local|internal|localhost)$/.test(host)
    || !normalizeBrandDomain(domain) || normalizeBrandDomain(host) !== normalizeBrandDomain(domain) || url.href.length > 2048) invalid()
  return url.href
}
function time(value: unknown, now: Date): string {
  const raw = text(value, 40), parsed = Date.parse(raw)
  if (!raw.includes('T') || !Number.isFinite(parsed) || parsed > now.getTime() + 300_000 || parsed < now.getTime() - 90 * 86400000) invalid()
  return new Date(parsed).toISOString().replace('.000Z', 'Z')
}
export type AnalyticsEvent = { eventId: string; occurredAt: string; pageUrl: string; sessions: number; conversions: number; revenueMinor: number; currency: string }
export function parseAnalyticsBatch(raw: unknown, domain: string, now = new Date()): { events: AnalyticsEvent[] } {
  const body = object(raw, ['events'])
  if (!Array.isArray(body.events) || !body.events.length || body.events.length > 100) invalid()
  const events = body.events.map(rawEvent => {
    const event = object(rawEvent, ['eventId', 'occurredAt', 'pageUrl', 'sessions', 'conversions', 'revenueMinor', 'currency'])
    const currency = text(event.currency, 3)
    if (!/^[A-Z]{3}$/.test(currency)) invalid()
    return { eventId: identifier(event.eventId), occurredAt: time(event.occurredAt, now), pageUrl: canonicalOutcomeUrl(event.pageUrl, domain), sessions: count(event.sessions), conversions: count(event.conversions), revenueMinor: count(event.revenueMinor), currency }
  })
  if (new Set(events.map(event => event.eventId)).size !== events.length) invalid()
  return { events }
}
export type IndexNowInput = { intentKey: string; urls: string[] }
function urls(value: unknown, domain: string, max: number): string[] {
  if (!Array.isArray(value) || !value.length || value.length > max) invalid()
  return [...new Set(value.map(url => canonicalOutcomeUrl(url, domain)))].sort()
}
export function parseIndexNow(raw: unknown, domain: string): IndexNowInput {
  const body = object(raw, ['intentKey', 'urls'])
  return { intentKey: identifier(body.intentKey), urls: urls(body.urls, domain, 100) }
}
export type DeploymentInput = { intentKey: string; externalId: string; deployedAt: string; urls: string[]; baselineScanId: string | null; workItemId: string | null }
export function parseDeployment(raw: unknown, domain: string, now = new Date()): DeploymentInput {
  const body = object(raw, ['intentKey', 'externalId', 'deployedAt', 'urls', 'baselineScanId', 'workItemId'])
  return { intentKey: identifier(body.intentKey), externalId: text(body.externalId, 128), deployedAt: time(body.deployedAt, now), urls: urls(body.urls, domain, 20), baselineScanId: body.baselineScanId == null ? null : uuid(body.baselineScanId), workItemId: body.workItemId == null ? null : uuid(body.workItemId) }
}
export type ClusterInput = { name: string; keywords: string[]; targetUrl: string }
export function parseCluster(raw: unknown, domain: string): ClusterInput {
  const body = object(raw, ['name', 'keywords', 'targetUrl'])
  if (!Array.isArray(body.keywords) || !body.keywords.length || body.keywords.length > 20) invalid()
  return { name: text(body.name, 100), keywords: [...new Set(body.keywords.map(value => text(value, 80).toLowerCase()))], targetUrl: canonicalOutcomeUrl(body.targetUrl, domain) }
}
export function parseOutcomeWindow(params: URLSearchParams, now = new Date()): { start: string; end: string } {
  const end = params.get('end') ?? now.toISOString().slice(0, 10)
  const valid = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date
  if (!valid(end)) invalid()
  const start = params.get('start') ?? new Date(Date.parse(end) - 27 * 86400000).toISOString().slice(0, 10)
  if (!valid(start) || !valid(end) || end < start || Date.parse(end) - Date.parse(start) > 89 * 86400000 || end > now.toISOString().slice(0, 10)) invalid()
  return { start, end }
}
