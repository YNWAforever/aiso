import { afterEach, describe, expect, it, vi } from 'vitest'
import { once } from 'node:events'
import { createServer, type RequestListener, type Server } from 'node:http'

import {
  __testOnlyRequestPinnedUrl,
  buildPinnedRequestOptions,
  createPublicUrlFetcher,
} from '@/lib/security/public-url'

const publicDns = async () => [{ address: '93.184.216.34', family: 4 as const }]
const servers: Server[] = []

async function withLoopbackServer(listener: RequestListener, run: (port: number) => Promise<void>) {
  const server = createServer(listener)
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected TCP server address')
  await run(address.port)
}

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})

describe('public URL network boundary', () => {
  it('pins the actual Node connection lookup to the validated DNS address', async () => {
    const { options, body } = buildPinnedRequestOptions(
      new URL('https://rebinding.example/webhook'),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scanId: 'scan-1' }),
      },
      { address: '93.184.216.34', family: 4 },
    )

    expect(body?.toString()).toBe(JSON.stringify({ scanId: 'scan-1' }))
    expect(options.servername).toBe('rebinding.example')
    expect(options.method).toBe('POST')
    expect(options.headers).toMatchObject({
      'content-type': 'application/json',
      'content-length': String(body?.byteLength),
    })
    expect(options.lookup).toBeTypeOf('function')

    const resolved = await new Promise<{ address: string; family: number }>((resolve, reject) => {
      options.lookup?.('rebinding.example', { family: 0, hints: 0 }, (error, address, family) => {
        if (error) reject(error)
        else resolve({ address: address as string, family: family as number })
      })
    })

    expect(resolved).toEqual({ address: '93.184.216.34', family: 4 })
  })

  it('uses the pinned address for a real Node request while preserving Host and POST body', async () => {
    let seen: { host?: string; contentType?: string; body: string } | undefined
    await withLoopbackServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', chunk => chunks.push(Buffer.from(chunk)))
      req.on('end', () => {
        seen = {
          host: req.headers.host,
          contentType: req.headers['content-type'],
          body: Buffer.concat(chunks).toString(),
        }
        res.end('ok')
      })
    }, async port => {
      const body = JSON.stringify({ scanId: 'scan-1' })
      const response = await __testOnlyRequestPinnedUrl(
        new URL('http://public.example:' + port + '/webhook'),
        { method: 'POST', headers: { 'content-type': 'application/json' }, body },
        { address: '127.0.0.1', family: 4 },
        1024,
        1000,
      )

      expect(await response.text()).toBe('ok')
      expect(seen).toEqual({
        host: 'public.example:' + port,
        contentType: 'application/json',
        body,
      })
    })
  })

  it.each([
    'ftp://example.com',
    'file:///etc/passwd',
    'javascript:alert(1)',
  ])('rejects the %s protocol before fetching', async url => {
    const fetchImpl = vi.fn()
    const safeFetch = createPublicUrlFetcher({ lookup: publicDns, fetchImpl })

    await expect(safeFetch(url)).rejects.toMatchObject({ code: 'UNSAFE_URL' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it.each([
    'http://localhost', 'http://api.localhost', 'http://127.0.0.1', 'http://2130706433',
    'http://0x7f000001', 'http://10.0.0.1', 'http://100.64.0.1', 'http://169.254.169.254',
    'http://172.16.0.1', 'http://192.168.1.1', 'http://192.0.2.1', 'http://198.18.0.1',
    'http://198.51.100.1', 'http://203.0.113.1', 'http://224.0.0.1', 'http://240.0.0.1',
    'http://[::1]', 'http://[::]', 'http://[::ffff:127.0.0.1]', 'http://[fc00::1]',
    'http://[fe80::1]', 'http://[ff02::1]', 'http://[2001:db8::1]', 'http://[2002:7f00:1::]',
  ])('rejects non-public address %s before fetching', async url => {
    const fetchImpl = vi.fn()
    const safeFetch = createPublicUrlFetcher({ lookup: publicDns, fetchImpl })

    await expect(safeFetch(url)).rejects.toMatchObject({ code: 'UNSAFE_URL' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects a hostname when any DNS answer is private', async () => {
    const fetchImpl = vi.fn()
    const safeFetch = createPublicUrlFetcher({
      lookup: async () => [
        { address: '93.184.216.34', family: 4 },
        { address: '10.0.0.8', family: 4 },
      ],
      fetchImpl,
    })

    await expect(safeFetch('https://rebinding.example')).rejects.toMatchObject({ code: 'UNSAFE_URL' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects a redirect to a private target before following it', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response(null, {
      status: 302,
      headers: { location: 'http://169.254.169.254/latest/meta-data' },
    }))
    const safeFetch = createPublicUrlFetcher({ lookup: publicDns, fetchImpl })

    await expect(safeFetch('https://public.example')).rejects.toMatchObject({ code: 'UNSAFE_URL' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ redirect: 'manual' })
  })

  it('strips cross-origin credentials and converts POST to GET for a 302 redirect', async () => {
    const requestImpl = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://other.example/next' } }))
      .mockResolvedValueOnce(new Response('ok'))
    const safeFetch = createPublicUrlFetcher({ lookup: publicDns, requestImpl })

    await safeFetch('https://public.example/start', {
      method: 'POST',
      headers: {
        authorization: 'Bearer secret',
        cookie: 'session=secret',
        'proxy-authorization': 'Basic secret',
        'content-type': 'application/json',
      },
      body: '{}',
    })

    const secondInit = requestImpl.mock.calls[1]?.[1] as RequestInit
    const headers = new Headers(secondInit.headers)
    expect(secondInit.method).toBe('GET')
    expect(secondInit.body).toBeUndefined()
    expect(headers.has('authorization')).toBe(false)
    expect(headers.has('cookie')).toBe(false)
    expect(headers.has('proxy-authorization')).toBe(false)
    expect(headers.has('content-type')).toBe(false)
  })

  it('preserves POST method and body for a 307 redirect', async () => {
    const requestImpl = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 307, headers: { location: '/next' } }))
      .mockResolvedValueOnce(new Response('ok'))
    const safeFetch = createPublicUrlFetcher({ lookup: publicDns, requestImpl })

    await safeFetch('https://public.example/start', { method: 'POST', body: 'payload' })

    expect(requestImpl.mock.calls[1]?.[1]).toMatchObject({ method: 'POST', body: 'payload' })
  })

  it('caps public redirect hops', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, {
      status: 302,
      headers: { location: '/next' },
    }))
    const safeFetch = createPublicUrlFetcher({ lookup: publicDns, fetchImpl, maxRedirects: 2 })

    await expect(safeFetch('https://public.example')).rejects.toMatchObject({ code: 'TOO_MANY_REDIRECTS' })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it.each(['content-length', 'stream'])('rejects an oversized %s response', async mode => {
    await withLoopbackServer((_req, res) => {
      if (mode === 'content-length') res.setHeader('content-length', '100')
      res.write('1234')
      res.end('5678')
    }, async port => {
      await expect(__testOnlyRequestPinnedUrl(
        new URL('http://public.example:' + port),
        {},
        { address: '127.0.0.1', family: 4 },
        5,
        1000,
      )).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' })
    })
  })

  it('aborts a pinned request after its timeout', async () => {
    await withLoopbackServer(() => {}, async port => {
      await expect(__testOnlyRequestPinnedUrl(
        new URL('http://public.example:' + port),
        {},
        { address: '127.0.0.1', family: 4 },
        1024,
        25,
      )).rejects.toThrow(/timed out/i)
    })
  })

  it('enforces an HTTPS-only policy on every public redirect hop', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response(null, {
      status: 302,
      headers: { location: 'http://other-public.example/logo.png' },
    }))
    const safeFetch = createPublicUrlFetcher({
      lookup: publicDns,
      fetchImpl,
      allowedProtocols: ['https:'],
    })

    await expect(safeFetch('https://public.example/logo.png')).rejects.toMatchObject({ code: 'UNSAFE_URL' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('times out a DNS resolver that never settles within the total request bound', async () => {
    const fetchImpl = vi.fn()
    const safeFetch = createPublicUrlFetcher({
      lookup: () => new Promise(() => {}),
      fetchImpl,
      timeoutMs: 25,
    })

    await expect(safeFetch('https://never-resolves.example')).rejects.toMatchObject({ name: 'TimeoutError' })
    expect(fetchImpl).not.toHaveBeenCalled()
  }, 500)

  it.each([
    'https://93.184.216.34/path',
    'https://[2606:4700:4700::1111]/',
    'https://public.example/path',
  ])('allows public URL %s', async url => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }))
    const safeFetch = createPublicUrlFetcher({ lookup: publicDns, fetchImpl })

    const response = await safeFetch(url)

    expect(response.status).toBe(200)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
