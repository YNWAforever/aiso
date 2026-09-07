import { emitFetchEvidence } from '@/lib/scan-evidence-context'
import { describeEvidenceUrl, parsedHeaderSignals } from '@/lib/scan-evidence'
import { lookup as nodeLookup } from 'node:dns/promises'
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http'
import { request as httpsRequest, type RequestOptions } from 'node:https'
import { BlockList, isIP } from 'node:net'

export type PublicUrlFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>
export type LookupAll = (hostname: string) => Promise<ReadonlyArray<ResolvedAddress>>

export type ResolvedAddress = { address: string; family: 4 | 6 }
type PublicUrlRequest = (
  url: URL,
  init: RequestInit,
  target: ResolvedAddress,
  maxResponseBytes: number,
  timeoutMs: number,
) => Promise<Response>

type PublicUrlFetcherOptions = {
  fetchImpl?: PublicUrlFetch
  requestImpl?: PublicUrlRequest
  lookup?: LookupAll
  maxRedirects?: number
  maxResponseBytes?: number
  timeoutMs?: number
  allowedProtocols?: ReadonlyArray<'http:' | 'https:'>
}

export class PublicUrlError extends Error {
  constructor(
    message: string,
    readonly code: 'UNSAFE_URL' | 'TOO_MANY_REDIRECTS' | 'RESPONSE_TOO_LARGE',
  ) {
    super(message)
    this.name = 'PublicUrlError'
  }
}

const blockedV4 = new BlockList()
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blockedV4.addSubnet(network, prefix, 'ipv4')

const globalV6 = new BlockList()
globalV6.addSubnet('2000::', 3, 'ipv6')
const blockedV6 = new BlockList()
blockedV6.addSubnet('2001::', 23, 'ipv6')
blockedV6.addSubnet('2001:db8::', 32, 'ipv6')
blockedV6.addSubnet('2002::', 16, 'ipv6')

function unbracket(hostname: string) {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
}

function isPublicAddress(address: string) {
  const normalized = unbracket(address)
  const family = isIP(normalized)
  if (family === 4) return !blockedV4.check(normalized, 'ipv4')
  if (family === 6) return globalV6.check(normalized, 'ipv6') && !blockedV6.check(normalized, 'ipv6')
  return false
}

async function defaultLookup(hostname: string) {
  const answers = await nodeLookup(hostname, { all: true, verbatim: true })
  return answers.map(answer => ({ address: answer.address, family: answer.family as 4 | 6 }))
}

function awaitWithAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    const onAbort = () => {
      cleanup()
      reject(signal.reason ?? new DOMException('The operation was aborted', 'AbortError'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) {
      onAbort()
      return
    }
    operation.then(
      value => {
        cleanup()
        if (signal.aborted) reject(signal.reason)
        else resolve(value)
      },
      error => { cleanup(); reject(error) },
    )
  })
}

async function resolvePublicUrl(
  url: URL,
  lookup: LookupAll,
  allowedProtocols: ReadonlySet<string>,
  signal: AbortSignal,
): Promise<ResolvedAddress> {
  signal.throwIfAborted()
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:')
    || !allowedProtocols.has(url.protocol)
  ) {
    throw new PublicUrlError('URL protocol is not allowed', 'UNSAFE_URL')
  }
  if (url.username || url.password) throw new PublicUrlError('URL credentials are not allowed', 'UNSAFE_URL')

  const hostname = unbracket(url.hostname).toLowerCase().replace(/\.$/, '')
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new PublicUrlError('Local hostnames are not allowed', 'UNSAFE_URL')
  }

  const literalFamily = isIP(hostname)
  const answers: ReadonlyArray<ResolvedAddress> = literalFamily
    ? [{ address: hostname, family: literalFamily as 4 | 6 }]
    : await awaitWithAbort(lookup(hostname), signal)
  signal.throwIfAborted()
  if (
    answers.length === 0
    || answers.some(answer => answer.family !== isIP(unbracket(answer.address)) || !isPublicAddress(answer.address))
  ) {
    throw new PublicUrlError('URL resolves to a non-public address', 'UNSAFE_URL')
  }
  return { address: unbracket(answers[0].address), family: answers[0].family }
}

function bodyToBuffer(body: BodyInit | null | undefined) {
  if (body == null) return undefined
  if (typeof body === 'string') return Buffer.from(body)
  if (body instanceof URLSearchParams) return Buffer.from(body.toString())
  if (body instanceof ArrayBuffer) return Buffer.from(body)
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength)
  throw new TypeError('Pinned public URL requests support string, URLSearchParams, and BufferSource bodies')
}

export function buildPinnedRequestOptions(url: URL, init: RequestInit, target: ResolvedAddress) {
  const body = bodyToBuffer(init.body)
  const headers = new Headers(init.headers)
  headers.delete('host')
  if (!headers.has('accept-encoding')) headers.set('accept-encoding', 'identity')
  if (body && !headers.has('content-length') && !headers.has('transfer-encoding')) {
    headers.set('content-length', String(body.byteLength))
  }

  const lookup: NonNullable<RequestOptions['lookup']> = (_hostname, _options, callback) => {
    callback(null, target.address, target.family)
  }
  const hostname = unbracket(url.hostname)
  const options: RequestOptions = {
    method: (init.method ?? 'GET').toUpperCase(),
    headers: Object.fromEntries(headers.entries()),
    family: target.family,
    lookup,
    signal: init.signal ?? undefined,
    servername: url.protocol === 'https:' && isIP(hostname) === 0 ? hostname : undefined,
  }
  return { options, body }
}

function responseHeaders(source: IncomingHttpHeaders) {
  const headers = new Headers()
  for (const [name, value] of Object.entries(source)) {
    if (Array.isArray(value)) value.forEach(item => headers.append(name, item))
    else if (value !== undefined) headers.set(name, value)
  }
  return headers
}

const requestPinnedUrl: PublicUrlRequest = async (url, init, target, maxResponseBytes, timeoutMs) => {
  const { options, body } = buildPinnedRequestOptions(url, init, target)
  const requestFn = url.protocol === 'https:' ? httpsRequest : httpRequest

  return new Promise<Response>((resolve, reject) => {
    const request = requestFn(url, options, response => {
      const contentLength = Number(response.headers['content-length'])
      if (Number.isFinite(contentLength) && contentLength > maxResponseBytes) {
        response.destroy()
        reject(new PublicUrlError('Response is too large', 'RESPONSE_TOO_LARGE'))
        return
      }

      const chunks: Buffer[] = []
      let received = 0
      response.on('data', chunk => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        received += buffer.byteLength
        if (received > maxResponseBytes) {
          reject(new PublicUrlError('Response is too large', 'RESPONSE_TOO_LARGE'))
          response.destroy()
          return
        }
        chunks.push(buffer)
      })
      response.once('aborted', () => reject(new Error('Public URL response aborted')))
      response.once('error', reject)
      response.once('end', () => {
        const status = response.statusCode ?? 502
        const responseBody = [101, 204, 205, 304].includes(status) ? null : Buffer.concat(chunks)
        resolve(new Response(responseBody, {
          status,
          statusText: response.statusMessage,
          headers: responseHeaders(response.headers),
        }))
      })
    })
    request.setTimeout(timeoutMs, () => request.destroy(new Error('Public URL request timed out')))
    request.once('error', reject)
    request.end(body)
  })
}

// Exposed only for network-isolated lower-level transport regression tests.
// Callers must use fetchPublicUrl/createPublicUrlFetcher so validation runs first.
export const __testOnlyRequestPinnedUrl = requestPinnedUrl

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

function redirectInit(status: number, init: RequestInit, from: URL, to: URL): RequestInit {
  const method = (init.method ?? 'GET').toUpperCase()
  const headers = new Headers(init.headers)
  let nextMethod = method
  let nextBody = init.body

  if ((status === 303 && method !== 'HEAD') || ((status === 301 || status === 302) && method === 'POST')) {
    nextMethod = 'GET'
    nextBody = undefined
    headers.delete('content-length')
    headers.delete('content-type')
  }
  if (from.origin !== to.origin) {
    headers.delete('authorization')
    headers.delete('cookie')
    headers.delete('proxy-authorization')
  }
  return { ...init, method: nextMethod, body: nextBody, headers }
}

export function createPublicUrlFetcher(options: PublicUrlFetcherOptions = {}): PublicUrlFetch {
  const requestImpl: PublicUrlRequest = options.requestImpl
    ?? (options.fetchImpl
      ? async (url, init) => options.fetchImpl!(url, { ...init, redirect: 'manual' })
      : requestPinnedUrl)
  const lookup = options.lookup ?? defaultLookup
  const maxRedirects = options.maxRedirects ?? 5
  const maxResponseBytes = options.maxResponseBytes ?? 5 * 1024 * 1024
  const timeoutMs = options.timeoutMs ?? 15_000
  const allowedProtocols = new Set(options.allowedProtocols ?? ['http:', 'https:'])

  return async (input, init = {}) => {
    let currentUrl = new URL(input instanceof Request ? input.url : input)
    const timeoutSignal = AbortSignal.timeout(timeoutMs)
    const requestSignal = init.signal
      ? AbortSignal.any([timeoutSignal, init.signal])
      : timeoutSignal
    let currentInit: RequestInit = { ...init, signal: requestSignal }
    try {
      for (let redirects = 0; ; redirects += 1) {
        const target = await resolvePublicUrl(currentUrl, lookup, allowedProtocols, requestSignal)
        const response = await requestImpl(
          currentUrl,
          {
            ...currentInit,
            redirect: 'manual',
            signal: requestSignal,
          },
          target,
          maxResponseBytes,
          timeoutMs,
        )
        const location = response.headers.get('location')
        if (!REDIRECT_STATUSES.has(response.status) || !location) {
          emitFetchEvidence({ observedAt: new Date().toISOString(), provenance: 'validated-fetch', target: describeEvidenceUrl(currentUrl.href), collection: response.ok || response.status === 404 || response.status === 410 ? 'complete' : 'failed', httpStatus: response.status, signals: parsedHeaderSignals(response.headers) })
          return response
        }
        if (redirects >= maxRedirects) {
          await response.body?.cancel()
          throw new PublicUrlError('Too many redirects', 'TOO_MANY_REDIRECTS')
        }
        const nextUrl = new URL(location, currentUrl)
        await response.body?.cancel()
        currentInit = redirectInit(response.status, currentInit, currentUrl, nextUrl)
        currentUrl = nextUrl
      }
    } catch (error) {
      emitFetchEvidence({ observedAt: new Date().toISOString(), provenance: 'validated-fetch', target: describeEvidenceUrl(''), collection: error instanceof PublicUrlError && error.code === 'UNSAFE_URL' ? 'blocked' : 'failed' })
      throw error
    }
  }
}

export const fetchPublicUrl = createPublicUrlFetcher()
