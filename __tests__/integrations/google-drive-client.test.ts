import { describe, expect, it, vi } from 'vitest'
import { DRIVE_UPLOAD_URL, DriveOutcomeUnknownError, GOOGLE_DOC_MIME, createGoogleDoc } from '@/lib/integrations/google-drive/client'
import { GoogleApiError } from '@/lib/integrations/google/oauth'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const input = { accessToken: 'UNIT_ACCESS_TOKEN', name: 'Thread · Brand', html: '<p>Body</p>' }

describe('createGoogleDoc', () => {
  it('sends one multipart create that converts HTML into a Google Doc', async () => {
    const f = vi.fn().mockResolvedValue(json({ id: 'file-1', webViewLink: 'https://docs.google.com/document/d/file-1/edit' }))
    expect(await createGoogleDoc(input, f)).toEqual({ fileId: 'file-1', webViewLink: 'https://docs.google.com/document/d/file-1/edit' })
    expect(f).toHaveBeenCalledTimes(1)
    const [url, init] = f.mock.calls[0]!
    expect(url).toBe(DRIVE_UPLOAD_URL)
    expect(new URL(url).searchParams.get('fields')).toBe('id,webViewLink')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toMatch(/^Bearer \S+$/)
    const boundary = /boundary=(\S+)/.exec(init.headers['Content-Type'])![1]
    expect(init.headers['Content-Type']).toBe(`multipart/related; boundary=${boundary}`)
    expect(init.body).toContain(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`)
    expect(init.body).toContain(JSON.stringify({ name: 'Thread · Brand', mimeType: GOOGLE_DOC_MIME }))
    expect(init.body).toContain('Content-Type: text/html; charset=UTF-8\r\n\r\n<p>Body</p>')
    expect(init.body.endsWith(`--${boundary}--\r\n`)).toBe(true)
    expect(init.body).not.toContain('UNIT_ACCESS_TOKEN')
  })

  it('never returns a link outside Google Docs/Drive', async () => {
    const f = vi.fn().mockResolvedValue(json({ id: 'file-1', webViewLink: 'https://evil.example/doc' }))
    expect((await createGoogleDoc(input, f)).webViewLink).toBeNull()
  })

  it('treats a lost response as an unknown outcome, with no retry', async () => {
    const f = vi.fn().mockRejectedValue(new TypeError('socket hang up'))
    await expect(createGoogleDoc(input, f)).rejects.toBeInstanceOf(DriveOutcomeUnknownError)
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('treats an OK response without a file id as unknown, not created', async () => {
    const f = vi.fn().mockResolvedValue(json({}))
    await expect(createGoogleDoc(input, f)).rejects.toBeInstanceOf(DriveOutcomeUnknownError)
  })

  it.each([
    [403, { error: { details: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }] } }, 'revoked'],
    [403, { error: { errors: [{ reason: 'storageQuotaExceeded' }] } }, 'forbidden'],
    [429, {}, 'quota'],
    [403, { error: { errors: [{ reason: 'userRateLimitExceeded' }] } }, 'quota'],
    [403, { error: { details: [{ reason: 'SERVICE_DISABLED' }] } }, 'misconfigured'],
    [500, {}, 'unavailable'],
  ])('classifies a %s refusal as %s (nothing created)', async (status, body, kind) => {
    const f = vi.fn().mockResolvedValue(json(body, status))
    const error = await createGoogleDoc(input, f).catch(e => e)
    expect(error).toBeInstanceOf(GoogleApiError)
    expect(error.kind).toBe(kind)
    expect(f).toHaveBeenCalledTimes(1)
  })
})
