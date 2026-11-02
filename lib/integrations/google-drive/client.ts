import { randomBytes } from 'node:crypto'
import { GOOGLE_TIMEOUT_MS, GoogleApiError, type GoogleFetch } from '@/lib/integrations/google/oauth'
import { classifyApiFailure } from '@/lib/integrations/search-console/client'

/**
 * Drive v3 multipart upload with conversion to a Google Doc. Only `drive.file`
 * is needed: the app creates the file, so it may open it. `fields` asks for the
 * two values we keep; nothing about the member's other files is requested.
 */
export const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink'
export const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document'
export const DRIVE_DOC_NAME_MAX = 200

/** The request may or may not have created a file: never retried automatically. */
export class DriveOutcomeUnknownError extends Error {
  constructor(readonly status: number) {
    super('drive_outcome_unknown')
    this.name = 'DriveOutcomeUnknownError'
  }
}

export type CreatedDoc = { fileId: string; webViewLink: string | null }

function safeLink(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && (url.hostname === 'docs.google.com' || url.hostname === 'drive.google.com') ? url.href : null
  } catch { return null }
}

export function buildMultipartBody(name: string, html: string, boundary: string): string {
  const metadata = JSON.stringify({ name: name.slice(0, DRIVE_DOC_NAME_MAX), mimeType: GOOGLE_DOC_MIME })
  return [
    `--${boundary}`, 'Content-Type: application/json; charset=UTF-8', '', metadata,
    `--${boundary}`, 'Content-Type: text/html; charset=UTF-8', '', html,
    `--${boundary}--`, '',
  ].join('\r\n')
}

/**
 * Exactly one create request; `files.create` is not idempotent, so there are no
 * retries. A known Google refusal throws GoogleApiError (nothing was created);
 * a lost response throws DriveOutcomeUnknownError (a file may exist).
 */
export async function createGoogleDoc(
  input: { accessToken: string; name: string; html: string },
  f: GoogleFetch = fetch,
): Promise<CreatedDoc> {
  const boundary = `aiso-${randomBytes(12).toString('hex')}`
  let res: Response
  try {
    res = await f(DRIVE_UPLOAD_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: buildMultipartBody(input.name, input.html, boundary),
      signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
    })
  } catch {
    // Sent or not, we cannot tell: the file may have been created.
    throw new DriveOutcomeUnknownError(0)
  }
  const parsed: unknown = await res.json().catch(() => null)
  if (!res.ok) throw new GoogleApiError(classifyApiFailure(res.status, parsed), res.status)
  const body = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
  if (typeof body.id !== 'string' || !body.id) throw new DriveOutcomeUnknownError(res.status)
  return { fileId: body.id, webViewLink: safeLink(body.webViewLink) }
}
