import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  fetchReportLogo,
  normalizeReportBranding,
  REPORT_LOGO_CACHE_CONTROL,
  REPORT_LOGO_MAX_BYTES,
} from '@/lib/reports/branding'
import { createPublicUrlFetcher, type PublicUrlFetch } from '@/lib/security/public-url'

const publicDns = async () => [{ address: '93.184.216.34', family: 4 as const }]

function branding(overrides: Partial<Parameters<typeof normalizeReportBranding>[0]> = {}) {
  return {
    agencyName: '  Acme Agency  ',
    logoUrl: null,
    primaryColor: '#12abEF',
    contactLabel: null,
    contactUrl: null,
    ...overrides,
  }
}

describe('report branding validation', () => {
  it('trims agency branding, normalizes six-digit hex, and keeps exact attribution', () => {
    expect(normalizeReportBranding(branding())).toEqual({
      agencyName: 'Acme Agency',
      logoUrl: null,
      primaryColor: '#12ABEF',
      contactLabel: null,
      contactUrl: null,
      attribution: 'Powered by Fimmick AISO',
    })
  })

  it.each(['', '   ', 'a'.repeat(121), 'Agency\u0000Name', 'Agency\r\nName'])(
    'rejects unsafe agency name %j',
    agencyName => expect(() => normalizeReportBranding(branding({ agencyName }))).toThrow(/agency name/i),
  )

  it.each(['#12345', '#1234567', '123456', '#GG0000', '#123456\n'])('rejects invalid six-digit color %j', primaryColor => {
    expect(() => normalizeReportBranding(branding({ primaryColor }))).toThrow(/color/i)
  })

  it.each([
    { contactLabel: ' Contact us ', contactUrl: ' https://agency.example/contact ' },
    { contactLabel: ' Email us ', contactUrl: ' mailto:hello@agency.example ' },
  ])('accepts and trims paired HTTPS or mailto CTA %#', contact => {
    expect(normalizeReportBranding(branding(contact))).toMatchObject({
      contactLabel: contact.contactLabel.trim(),
      contactUrl: contact.contactUrl.trim(),
    })
  })

  it.each([
    { contactLabel: 'Contact us', contactUrl: null },
    { contactLabel: null, contactUrl: 'https://agency.example' },
    { contactLabel: 'Contact', contactUrl: 'http://agency.example' },
    { contactLabel: 'Contact', contactUrl: 'javascript:alert(1)' },
    { contactLabel: 'Contact\r\nX-Test: injected', contactUrl: 'https://agency.example' },
    { contactLabel: 'Contact', contactUrl: 'https://agency.example/%0d%0aX-Test' },
    { contactLabel: 'Contact', contactUrl: 'mailto:hello@example.com%0ABcc:attacker@example.com' },
  ])('rejects incomplete or unsafe CTA %#', contact => {
    expect(() => normalizeReportBranding(branding(contact))).toThrow(/contact|CTA/i)
  })
})

describe('report logo fetch', () => {
  it.each(['http://public.example/logo.png', 'https://user:pass@public.example/logo.png'])(
    'rejects unsafe logo URL %s before transport',
    async url => {
      const transport = vi.fn()
      const fetcher = createPublicUrlFetcher({ lookup: publicDns, fetchImpl: transport })
      await expect(fetchReportLogo(url, { fetcher })).rejects.toThrow(/HTTPS|credentials|safe public/i)
      expect(transport).not.toHaveBeenCalled()
    },
  )

  it.each(['https://127.0.0.1/logo.png', 'https://169.254.169.254/logo.png'])(
    'rejects private logo host %s through the shared public URL boundary',
    async url => {
      const transport = vi.fn()
      const fetcher = createPublicUrlFetcher({ lookup: publicDns, fetchImpl: transport })
      await expect(fetchReportLogo(url, { fetcher })).rejects.toMatchObject({ code: 'UNSAFE_URL' })
      expect(transport).not.toHaveBeenCalled()
    },
  )

  it('rejects redirect-to-private through the shared redirect and DNS boundary', async () => {
    const transport = vi.fn().mockResolvedValueOnce(new Response(null, {
      status: 302,
      headers: { location: 'http://169.254.169.254/latest/meta-data' },
    }))
    const fetcher = createPublicUrlFetcher({ lookup: publicDns, fetchImpl: transport })

    await expect(fetchReportLogo('https://public.example/logo.png', { fetcher }))
      .rejects.toMatchObject({ code: 'UNSAFE_URL' })
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it.each(['image/png', 'image/jpeg', 'image/webp'])('accepts %s and sends a credential-free image request', async contentType => {
    const fetcher = vi.fn<PublicUrlFetch>().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), {
      headers: {
        'content-type': `${contentType}; charset=binary`,
        etag: '"safe-etag"',
        'last-modified': 'Tue, 21 Jul 2026 09:00:00 GMT',
        'set-cookie': 'session=secret',
        'content-security-policy': "default-src 'none'",
        location: 'https://attacker.example',
      },
    }))

    const result = await fetchReportLogo('https://cdn.example/logo', { fetcher })

    expect(result).toEqual({
      bytes: new Uint8Array([1, 2, 3]),
      contentType,
      etag: '"safe-etag"',
      lastModified: 'Tue, 21 Jul 2026 09:00:00 GMT',
      cacheControl: REPORT_LOGO_CACHE_CONTROL,
    })
    const init = fetcher.mock.calls[0]?.[1]
    const headers = new Headers(init?.headers)
    expect(headers.get('accept')).toBe('image/png, image/jpeg, image/webp')
    expect(headers.get('user-agent')).toMatch(/Fimmick AISO Logo Fetcher/i)
    expect(init?.credentials).toBe('omit')
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    expect(result).not.toHaveProperty('headers')
  })

  it.each(['text/html', 'image/svg+xml', 'application/octet-stream', null])('rejects unapproved content type %s', async contentType => {
    const headers = contentType ? { 'content-type': contentType } : undefined
    const fetcher = vi.fn<PublicUrlFetch>().mockResolvedValue(new Response('<svg/>', { headers }))
    await expect(fetchReportLogo('https://cdn.example/logo', { fetcher })).rejects.toThrow(/content type/i)
  })

  it('rejects an oversized declared response before reading it', async () => {
    let pulled = false
    const stream = new ReadableStream<Uint8Array>({ pull() { pulled = true } }, { highWaterMark: 0 })
    const fetcher = vi.fn<PublicUrlFetch>().mockResolvedValue(new Response(stream, {
      headers: { 'content-type': 'image/png', 'content-length': String(REPORT_LOGO_MAX_BYTES + 1) },
    }))

    await expect(fetchReportLogo('https://cdn.example/logo', { fetcher })).rejects.toThrow(/2 MiB|large/i)
    expect(pulled).toBe(false)
  })

  it('enforces the 2 MiB streamed cap without Content-Length', async () => {
    const chunk = new Uint8Array(1024 * 1024)
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk)
        controller.enqueue(chunk)
        controller.enqueue(new Uint8Array([1]))
        controller.close()
      },
    })
    const fetcher = vi.fn<PublicUrlFetch>().mockResolvedValue(new Response(stream, {
      headers: { 'content-type': 'image/png' },
    }))

    await expect(fetchReportLogo('https://cdn.example/logo', { fetcher })).rejects.toThrow(/2 MiB|large/i)
  })

  it('drops unsafe validators instead of forwarding arbitrary upstream metadata', async () => {
    const fetcher = vi.fn<PublicUrlFetch>().mockResolvedValue(new Response(new Uint8Array([1]), {
      headers: {
        'content-type': 'image/png',
        etag: 'not-an-etag',
        'last-modified': 'not an HTTP date',
        'cache-control': 'public, max-age=31536000',
        vary: '*',
      },
    }))

    await expect(fetchReportLogo('https://cdn.example/logo', { fetcher })).resolves.toEqual({
      bytes: new Uint8Array([1]),
      contentType: 'image/png',
      etag: null,
      lastModified: null,
      cacheControl: REPORT_LOGO_CACHE_CONTROL,
    })
  })
})
