import { randomBytes } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GoogleApiError } from '@/lib/integrations/google/oauth'
import { sealToken } from '@/lib/integrations/google/vault'
import { DriveOutcomeUnknownError } from '@/lib/integrations/google-drive/client'
import { exportTurnToGoogleDoc, type DriveExportDeps } from '@/lib/conversation-studio/drive-export'
import type { StudioReply } from '@/lib/conversation-studio/types'

vi.mock('server-only', () => ({}))

const accountId = '22222222-2222-4222-8222-222222222222'
const profileId = '11111111-1111-4111-8111-111111111111'
const input = { accountId, profileId, clientId: '33333333-3333-4333-8333-333333333333', threadId: '44444444-4444-4444-8444-444444444444', position: 2, locale: 'en' as const }
const reply = { status: 'insufficient', template: null, observations: [], scan: null, researchSteps: [], coverage: { pulse: 'missing', citations: 'missing', scan: 'missing', live: 'unsupported' } } as StudioReply

let deps: DriveExportDeps
beforeEach(() => {
  process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64')
  const sealed = sealToken('UNIT_REFRESH', { accountId, purpose: `drive:${profileId}` })
  deps = {
    loadTurn: vi.fn().mockResolvedValue({ brandName: 'Brand', threadTitle: 'Thread', prompt: 'Question?', reply }),
    loadCredential: vi.fn().mockResolvedValue({ status: 'active', sealed }),
    markReconnect: vi.fn().mockResolvedValue(undefined),
    accessToken: vi.fn().mockResolvedValue('ACCESS'),
    create: vi.fn().mockResolvedValue({ fileId: 'file-1', webViewLink: 'https://docs.google.com/document/d/file-1/edit' }),
    record: vi.fn().mockResolvedValue(undefined),
    now: () => new Date('2026-11-02T10:00:00Z'),
  }
})

const run = () => exportTurnToGoogleDoc(input, deps)

describe('exportTurnToGoogleDoc', () => {
  it('creates exactly one Doc from the saved turn and records it', async () => {
    expect(await run()).toEqual({ status: 201, body: { outcome: 'created', link: 'https://docs.google.com/document/d/file-1/edit' } })
    expect(deps.loadTurn).toHaveBeenCalledWith(accountId, input.clientId, profileId, input.threadId, 2)
    expect(deps.accessToken).toHaveBeenCalledWith('UNIT_REFRESH')
    expect(deps.create).toHaveBeenCalledTimes(1)
    const created = vi.mocked(deps.create).mock.calls[0]![0]
    expect(created).toMatchObject({ accessToken: 'ACCESS', name: 'Thread · Brand' })
    expect(created.html).toContain('Question?')
    expect(created.html).toContain('2026-11-02T10:00:00.000Z')
    expect(deps.record).toHaveBeenCalledWith({ accountId, clientId: input.clientId, profileId, threadId: input.threadId, position: 2, outcome: 'created', fileId: 'file-1', link: 'https://docs.google.com/document/d/file-1/edit' })
  })

  it('is 404 for a turn that is not the member’s own, before any Google work', async () => {
    vi.mocked(deps.loadTurn).mockResolvedValue(null)
    expect(await run()).toEqual({ status: 404, body: { error: 'NOT_FOUND' } })
    expect(deps.loadCredential).not.toHaveBeenCalled()
    expect(deps.create).not.toHaveBeenCalled()
  })

  it('is 409 when not connected or when a reconnect is already needed, with no Google call', async () => {
    vi.mocked(deps.loadCredential).mockResolvedValueOnce(null)
    expect(await run()).toEqual({ status: 409, body: { error: 'DRIVE_NOT_CONNECTED' } })
    vi.mocked(deps.loadCredential).mockResolvedValueOnce({ status: 'needs_reconnect', sealed: { ciphertext: Buffer.from('x'), keyId: 'k' } })
    expect(await run()).toEqual({ status: 409, body: { error: 'DRIVE_RECONNECT' } })
    expect(deps.accessToken).not.toHaveBeenCalled()
    expect(deps.create).not.toHaveBeenCalled()
  })

  it('flips the connection to reconnect when Google says the grant is dead', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(deps.accessToken).mockRejectedValue(new GoogleApiError('revoked', 400, 'invalid_grant'))
    try {
      expect(await run()).toEqual({ status: 409, body: { error: 'DRIVE_RECONNECT' } })
      expect(deps.markReconnect).toHaveBeenCalledWith(accountId, profileId)
      expect(deps.create).not.toHaveBeenCalled()
    } finally { error.mockRestore() }
  })

  it('never flips the connection on our own misconfiguration', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(deps.accessToken).mockRejectedValue(new GoogleApiError('misconfigured', 401, 'invalid_client'))
    try {
      expect(await run()).toEqual({ status: 503, body: { error: 'DRIVE_MISCONFIGURED' } })
      expect(deps.markReconnect).not.toHaveBeenCalled()
    } finally { error.mockRestore() }
  })

  it('records an unknown outcome and never retries', async () => {
    vi.mocked(deps.create).mockRejectedValue(new DriveOutcomeUnknownError(0))
    expect(await run()).toEqual({ status: 202, body: { outcome: 'unknown' } })
    expect(deps.create).toHaveBeenCalledTimes(1)
    expect(deps.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'unknown' }))
    expect(vi.mocked(deps.record).mock.calls[0]![0]).not.toHaveProperty('fileId')
  })

  it.each([
    ['quota', 429, 'DRIVE_QUOTA'],
    ['forbidden', 403, 'DRIVE_FORBIDDEN'],
    ['unavailable', 502, 'DRIVE_UNAVAILABLE'],
    ['revoked', 409, 'DRIVE_RECONNECT'],
  ] as const)('maps a %s refusal (nothing created) to %s and records failed', async (kind, status, code) => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(deps.create).mockRejectedValue(new GoogleApiError(kind, 403))
    try {
      expect(await run()).toEqual({ status, body: { error: code } })
      expect(deps.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'failed' }))
      expect(deps.markReconnect).toHaveBeenCalledTimes(kind === 'revoked' ? 1 : 0)
    } finally { error.mockRestore() }
  })

  it('never answers 2xx over a failed ledger write, and still hands back the link', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(deps.record).mockRejectedValue(new Error('postgresql://user:secret@host/db'))
    try {
      expect(await run()).toEqual({ status: 500, body: { error: 'DRIVE_LEDGER_FAILED', link: 'https://docs.google.com/document/d/file-1/edit' } })
      expect(error.mock.calls.flat().map(String).join(' ')).not.toContain('postgresql://')
      vi.mocked(deps.create).mockRejectedValue(new DriveOutcomeUnknownError(0))
      expect((await run()).status).toBe(500)
    } finally { error.mockRestore() }
  })

  it('is 503 when the turn or connection lookup fails, never "not found"', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      vi.mocked(deps.loadTurn).mockRejectedValueOnce(new Error('down'))
      expect((await run()).status).toBe(503)
      vi.mocked(deps.loadCredential).mockRejectedValueOnce(new Error('down'))
      expect((await run()).status).toBe(503)
    } finally { error.mockRestore() }
  })
})
