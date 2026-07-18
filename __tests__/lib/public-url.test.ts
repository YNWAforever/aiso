import { describe, expect, it, vi } from 'vitest'

import {
  buildPinnedRequestOptions,
  createPublicUrlFetcher,
} from '@/lib/security/public-url'

const publicDns = async () => [{ address: '93.184.216.34', family: 4 as const }]

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
    expect(options.headers).toMatchObject({ 'content-type': 'application/json' })
    expect(options.lookup).toBeTypeOf('function')

    const resolved = await new Promise<{ address: string; family: number }>((resolve, reject) => {
      options.lookup?.('rebinding.example', { family: 0, hints: 0 }, (error, address, family) => {
        if (error) reject(error)
        else resolve({ address: address as string, family: family as number })
      })
    })

    expect(resolved).toEqual({ address: '93.184.216.34', family: 4 })
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
    'http://localhost',
    'http://api.localhost',
    'http://127.0.0.1',
    'http://2130706433',
    'http://0x7f000001',
    'http://10.0.0.1',
    'http://100.64.0.1',
    'http://169.254.169.254',
    'http://172.16.0.1',
    'http://192.168.1.1',
    'http://192.0.2.1',
    'http://198.18.0.1',
    'http://198.51.100.1',
    'http://203.0.113.1',
    'http://224.0.0.1',
    'http://240.0.0.1',
    'http://[::1]',
    'http://[::]',
    'http://[::ffff:127.0.0.1]',
    'http://[fc00::1]',
    'http://[fe80::1]',
    'http://[ff02::1]',
    'http://[2001:db8::1]',
    'http://[2002:7f00:1::]',
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

  it('caps public redirect hops', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, {
      status: 302,
      headers: { location: '/next' },
    }))
    const safeFetch = createPublicUrlFetcher({ lookup: publicDns, fetchImpl, maxRedirects: 2 })

    await expect(safeFetch('https://public.example')).rejects.toMatchObject({ code: 'TOO_MANY_REDIRECTS' })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

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
