import { describe, expect, it, vi } from 'vitest'
import { acquireAccessToken, type TokenDeps } from '@/lib/integrations/google/access'
import { GoogleApiError } from '@/lib/integrations/google/oauth'
import { VaultError } from '@/lib/integrations/google/vault'

const SEALED = { ciphertext: Buffer.from('x'), keyId: 'k' }

function deps(over: Partial<TokenDeps> = {}): TokenDeps {
  return {
    loadSecret: vi.fn().mockResolvedValue({ status: 'active', sealed: SEALED, scopes: ['s1', 's2'] }),
    open: vi.fn().mockReturnValue('1//refresh'),
    refresh: vi.fn().mockResolvedValue('ya29.access'),
    markConnection: vi.fn().mockResolvedValue(undefined),
    ...over,
  }
}

const input = (over: Partial<Parameters<typeof acquireAccessToken>[1]> = {}) => ({
  accountId: 'a', connectionId: 'g', clientId: 'c', outOfTime: () => false, logTag: '[test]', ...over,
})

describe('acquireAccessToken', () => {
  it('returns the access token and the secret scopes on success', async () => {
    const d = deps()
    expect(await acquireAccessToken(d, input())).toEqual({ ok: true, accessToken: 'ya29.access', scopes: ['s1', 's2'] })
    expect(d.loadSecret).toHaveBeenCalledWith('a', 'g')
    expect(d.open).toHaveBeenCalledWith(SEALED, 'a')
    expect(d.refresh).toHaveBeenCalledWith('1//refresh')
    expect(d.markConnection).not.toHaveBeenCalled()
  })

  it('returns empty scopes when the secret carries none', async () => {
    const d = deps({ loadSecret: vi.fn().mockResolvedValue({ status: 'active', sealed: SEALED }) })
    expect(await acquireAccessToken(d, input())).toEqual({ ok: true, accessToken: 'ya29.access', scopes: [] })
  })

  it.each([
    ['a missing secret', null],
    ['an inactive secret', { status: 'needs_reconnect', sealed: SEALED, scopes: [] }],
    ['an unsealed secret', { status: 'active', sealed: null, scopes: [] }],
  ])('gives revoked for %s, without opening or refreshing', async (_name, secret) => {
    const d = deps({ loadSecret: vi.fn().mockResolvedValue(secret) })
    expect(await acquireAccessToken(d, input())).toEqual({ ok: false, outcome: 'revoked' })
    expect(d.open).not.toHaveBeenCalled()
    expect(d.refresh).not.toHaveBeenCalled()
    expect(d.markConnection).not.toHaveBeenCalled()
  })

  it('gives vault_error for a VaultError and logs only clientId and code under the tag', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const d = deps({ open: vi.fn(() => { throw new VaultError('VAULT_KEY_UNKNOWN') }) })
      expect(await acquireAccessToken(d, input())).toEqual({ ok: false, outcome: 'vault_error' })
      expect(spy).toHaveBeenCalledWith('[test] vault failure', { clientId: 'c', code: 'VAULT_KEY_UNKNOWN' })
      expect(d.refresh).not.toHaveBeenCalled()
      expect(d.markConnection).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })

  it('rethrows any other error from open', async () => {
    const boom = new Error('boom')
    const d = deps({ open: vi.fn(() => { throw boom }) })
    await expect(acquireAccessToken(d, input())).rejects.toBe(boom)
  })

  it('gives deferred, with no refresh, when out of time', async () => {
    const d = deps()
    expect(await acquireAccessToken(d, input({ outOfTime: () => true }))).toEqual({ ok: false, outcome: 'deferred' })
    expect(d.refresh).not.toHaveBeenCalled()
    expect(d.markConnection).not.toHaveBeenCalled()
  })

  it('marks the connection for reconnect, once, when the refresh token is dead', async () => {
    const d = deps({ refresh: vi.fn().mockRejectedValue(new GoogleApiError('revoked', 400)) })
    expect(await acquireAccessToken(d, input())).toEqual({ ok: false, outcome: 'revoked' })
    expect(d.markConnection).toHaveBeenCalledTimes(1)
    expect(d.markConnection).toHaveBeenCalledWith('a', 'g', 'needs_reconnect')
  })

  it('gives config_error for a misconfigured refresh and logs clientId, status and code', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const d = deps({ refresh: vi.fn().mockRejectedValue(new GoogleApiError('misconfigured', 401, 'invalid_client')) })
      expect(await acquireAccessToken(d, input())).toEqual({ ok: false, outcome: 'config_error' })
      expect(spy).toHaveBeenCalledWith('[test] google misconfigured', { clientId: 'c', status: 401, code: 'invalid_client' })
      expect(d.markConnection).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })

  it.each([
    ['unavailable', 'google_unavailable'],
    ['quota', 'quota'],
  ] as const)('gives %s -> %s for a refresh failure, and never marks the connection', async (kind, outcome) => {
    const d = deps({ refresh: vi.fn().mockRejectedValue(new GoogleApiError(kind, 0)) })
    expect(await acquireAccessToken(d, input())).toEqual({ ok: false, outcome })
    expect(d.markConnection).not.toHaveBeenCalled()
  })

  it('rethrows a refresh GoogleApiError it does not classify (forbidden) and a non-Google error', async () => {
    const forbidden = new GoogleApiError('forbidden', 403)
    await expect(acquireAccessToken(deps({ refresh: vi.fn().mockRejectedValue(forbidden) }), input())).rejects.toBe(forbidden)
    const boom = new Error('boom')
    await expect(acquireAccessToken(deps({ refresh: vi.fn().mockRejectedValue(boom) }), input())).rejects.toBe(boom)
  })

  it('calls markConnection only for revoked, across every outcome', async () => {
    const kinds = ['revoked', 'misconfigured', 'unavailable', 'quota'] as const
    for (const kind of kinds) {
      const d = deps({ refresh: vi.fn().mockRejectedValue(new GoogleApiError(kind, 0)) })
      await acquireAccessToken(d, input())
      expect((d.markConnection as ReturnType<typeof vi.fn>).mock.calls.length).toBe(kind === 'revoked' ? 1 : 0)
    }
  })
})
