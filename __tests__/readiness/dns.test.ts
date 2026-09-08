import { Resolver } from 'node:dns/promises'
import { createSocket } from 'node:dgram'
import { once, getEventListeners } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { createReadinessLookup } from '@/lib/readiness/dns'
import { createPublicUrlFetcher } from '@/lib/security/public-url'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function fixture() {
  const v4 = deferred<string[]>(), v6 = deferred<string[]>()
  const resolver = { resolve4: vi.fn(() => v4.promise), resolve6: vi.fn(() => v6.promise), cancel: vi.fn() }
  const factory = vi.fn(() => resolver)
  return { v4, v6, resolver, factory, lookup: createReadinessLookup(factory) }
}
const dnsError = (code: string) => Object.assign(new Error(code), { code })

describe('readiness DNS ownership and validation', () => {
  it('does no allocation or queries when already aborted', async () => {
    const f = fixture(), controller = new AbortController()
    controller.abort()
    await expect(f.lookup('issuer.example', controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(f.factory).not.toHaveBeenCalled()
  })
  it('waits for both families, returns IPv4 first, and removes abort listeners on success', async () => {
    const f = fixture(), controller = new AbortController()
    const pending = f.lookup('issuer.example', controller.signal)
    expect(f.resolver.resolve4).toHaveBeenCalledWith('issuer.example')
    expect(f.resolver.resolve6).toHaveBeenCalledWith('issuer.example')
    f.v6.resolve(['2606:4700:4700::1111'])
    const done = vi.fn(); void pending.then(done)
    await Promise.resolve(); expect(done).not.toHaveBeenCalled()
    f.v4.resolve(['1.1.1.1'])
    expect(await pending).toEqual([{ address: '1.1.1.1', family: 4 }, { address: '2606:4700:4700::1111', family: 6 }])
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0)
    expect(f.resolver.cancel).toHaveBeenCalledTimes(1)
    controller.abort(); expect(f.resolver.cancel).toHaveBeenCalledTimes(1)
  })
  it.each(['v4', 'v6'] as const)('accepts ENODATA only as an empty %s family', async family => {
    const f = fixture()
    const pending = f.lookup('issuer.example')
    f[family].reject(dnsError('ENODATA'))
    f[family === 'v4' ? 'v6' : 'v4'].resolve(family === 'v4' ? ['2606:4700:4700::1111'] : ['1.1.1.1'])
    expect(await pending).toHaveLength(1)
  })
  it.each(['ENOTFOUND', 'ETIMEOUT', 'ESERVFAIL', 'EREFUSED'])('fails closed for %s despite a successful other family', async code => {
    for (const family of ['v4', 'v6'] as const) {
      const f = fixture(), controller = new AbortController()
      const pending = f.lookup('issuer.example', controller.signal)
      f[family === 'v4' ? 'v6' : 'v4'].resolve(['1.1.1.1'])
      f[family].reject(dnsError(code))
      await expect(pending).rejects.toMatchObject({ code })
      expect(f.resolver.cancel).toHaveBeenCalledTimes(1)
      expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0)
    }
  })
  it('cancels the pending sibling on DNS failure and consumes its late rejection', async () => {
    const f = fixture()
    const pending = f.lookup('issuer.example')
    f.v4.reject(dnsError('ESERVFAIL'))
    await expect(pending).rejects.toMatchObject({ code: 'ESERVFAIL' })
    expect(f.resolver.cancel).toHaveBeenCalledTimes(1)
    f.v6.reject(dnsError('ECANCELLED'))
    await new Promise(resolve => setImmediate(resolve))
  })
  it('isolates concurrent lookups and cleans up abort listeners even with late DNS rejection', async () => {
    const first = fixture(), second = fixture(), controller = new AbortController()
    const factory = vi.fn().mockReturnValueOnce(first.resolver).mockReturnValueOnce(second.resolver)
    const lookup = createReadinessLookup(factory)
    const a = lookup('first.example', controller.signal), b = lookup('second.example')
    controller.abort()
    await expect(a).rejects.toMatchObject({ name: 'AbortError' })
    expect(first.resolver.cancel).toHaveBeenCalledTimes(1)
    expect(second.resolver.cancel).not.toHaveBeenCalled()
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0)
    first.v4.reject(dnsError('ECANCELLED')); first.v6.reject(dnsError('ECANCELLED'))
    second.v4.resolve(['1.1.1.1']); second.v6.reject(dnsError('ENODATA'))
    expect(await b).toEqual([{ address: '1.1.1.1', family: 4 }])
    await new Promise(resolve => setImmediate(resolve))
  })
  it.each([['1.1.1.1', '::1'], ['127.0.0.1', '2606:4700:4700::1111']])('blocks mixed public/private families before requesting HTTP: %s %s', async (v4, v6) => {
    const f = fixture(), requestImpl = vi.fn()
    const fetcher = createPublicUrlFetcher({ lookup: f.lookup, requestImpl })
    const pending = fetcher('https://issuer.example')
    f.v4.resolve([v4]); f.v6.resolve([v6])
    await expect(pending).rejects.toMatchObject({ code: 'UNSAFE_URL' })
    expect(requestImpl).not.toHaveBeenCalled()
  })
  it('rejects both empty families before HTTP', async () => {
    const f = fixture(), requestImpl = vi.fn()
    const pending = createPublicUrlFetcher({ lookup: f.lookup, requestImpl })('https://issuer.example')
    f.v4.reject(dnsError('ENODATA')); f.v6.reject(dnsError('ENODATA'))
    await expect(pending).rejects.toMatchObject({ code: 'UNSAFE_URL' })
    expect(requestImpl).not.toHaveBeenCalled()
  })
  it('pins one validated address only after both direct DNS answers succeed', async () => {
    const f = fixture(), requestImpl = vi.fn(async () => new Response('ok'))
    const pending = createPublicUrlFetcher({ lookup: f.lookup, requestImpl })('https://issuer.example')
    f.v4.resolve(['1.1.1.1']); f.v6.resolve(['2606:4700:4700::1111'])
    expect((await pending).status).toBe(200)
    expect(requestImpl.mock.calls[0]).toEqual(expect.arrayContaining([{ address: '1.1.1.1', family: 4 }]))
  })
})

it('cancels both real Node Resolver queries with ECANCELLED against a local silent UDP DNS server', async () => {
  const server = createSocket('udp4')
  const controller = new AbortController()
  let resolver: Resolver | undefined
  const codes: string[] = []
  const queries: Promise<string[]>[] = []
  let deadline: ReturnType<typeof setTimeout> | undefined
  try {
    server.bind(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    const bothReceived = deferred<void>()
    const types: number[] = []
    server.on('message', message => {
      types.push(message.readUInt16BE(message.length - 4))
      if (types.length === 2) bothReceived.resolve()
    })
    const lookup = createReadinessLookup(() => {
      resolver = new Resolver({ timeout: 5000, tries: 1 })
      resolver.setServers([`127.0.0.1:${address.port}`])
      const capture = (query: Promise<string[]>) => {
        const captured = query.catch(error => { codes.push(error.code); throw error })
        queries.push(captured)
        return captured
      }
      return { resolve4: hostname => capture(resolver!.resolve4(hostname)), resolve6: hostname => capture(resolver!.resolve6(hostname)), cancel: () => resolver!.cancel() }
    })
    const pending = lookup('cancel-proof.invalid', controller.signal)
    await Promise.race([bothReceived.promise, new Promise<never>((_resolve, reject) => { deadline = setTimeout(() => reject(new Error('Local DNS queries did not arrive')), 2000) })])
    clearTimeout(deadline)
    expect(types.sort((a, b) => a - b)).toEqual([1, 28])
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    const settled = await Promise.allSettled(queries)
    expect(settled.map(result => result.status)).toEqual(['rejected', 'rejected'])
    expect(codes).toEqual(['ECANCELLED', 'ECANCELLED'])
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0)
  } finally {
    clearTimeout(deadline)
    controller.abort()
    resolver?.cancel()
    await Promise.allSettled(queries)
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
}, 10000)
