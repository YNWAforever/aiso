import { Resolver } from 'node:dns/promises'
import type { LookupAll } from '@/lib/security/public-url'

type ReadinessResolver = {
  resolve4(hostname: string): Promise<string[]>
  resolve6(hostname: string): Promise<string[]>
  cancel(): void
}

/**
 * Public readiness issuer/candidate hosts use direct DNS (no hosts file/NSS).
 * Check both families before pinning, with IPv4 first instead of OS ordering.
 * Each lookup owns its resolver: aborting one probe never cancels another.
 */
export function createReadinessLookup(
  createResolver: () => ReadinessResolver = () => new Resolver({ timeout: 5000, tries: 1 }),
): LookupAll {
  return async (hostname, signal) => {
    signal?.throwIfAborted()
    const resolver = createResolver()
    let cancelled = false
    const cancel = () => {
      if (!cancelled) { cancelled = true; resolver.cancel() }
    }
    let rejectAbort: (reason: unknown) => void = () => {}
    const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject })
    const onAbort = () => { cancel(); rejectAbort(signal?.reason ?? new DOMException('The operation was aborted', 'AbortError')) }
    signal?.addEventListener('abort', onAbort, { once: true })
    const family = async (resolve: () => Promise<string[]>) => {
      try { return await resolve() }
      catch (error) {
        // Only a missing record family is empty. Any other DNS failure fails closed.
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENODATA') return []
        throw error
      }
    }
    try {
      signal?.throwIfAborted()
      const answers = Promise.all([
        family(() => resolver.resolve4(hostname)),
        family(() => resolver.resolve6(hostname)),
      ])
      const [v4, v6] = await Promise.race([answers, aborted])
      signal?.throwIfAborted()
      return [...v4.map(address => ({ address, family: 4 as const })), ...v6.map(address => ({ address, family: 6 as const }))]
    } finally {
      signal?.removeEventListener('abort', onAbort)
      cancel()
    }
  }
}
