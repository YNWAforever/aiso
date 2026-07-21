import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const mocks = vi.hoisted(() => {
  const logoTransport = vi.fn()
  return {
    logoTransport,
    createPublicUrlFetcher: vi.fn(() => logoTransport),
  }
})

vi.mock('@/lib/security/public-url', () => ({
  createPublicUrlFetcher: mocks.createPublicUrlFetcher,
}))

import {
  fetchReportLogo,
  normalizeReportBranding,
  REPORT_LOGO_CACHE_CONTROL,
  REPORT_LOGO_MAX_BYTES,
} from '@/lib/reports/branding'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const JPEG = new Uint8Array([0xff, 0xd8, 0xff])
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
])

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

beforeEach(() => mocks.logoTransport.mockReset())

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
  it('constructs a pinned HTTPS-only fetcher with the logo byte and timeout bounds', () => {
    expect(mocks.createPublicUrlFetcher).toHaveBeenCalledWith({
      allowedProtocols: ['https:'],
      maxResponseBytes: REPORT_LOGO_MAX_BYTES,
      timeoutMs: 10_000,
    })
  })

  it.each(['http://public.example/logo.png', 'https://user:pass@public.example/logo.png'])(
    'rejects unsafe logo URL %s before transport',
    async url => {
      await expect(fetchReportLogo(url)).rejects.toThrow(/HTTPS|credentials|safe public/i)
      expect(mocks.logoTransport).not.toHaveBeenCalled()
    },
  )

  it.each([
    ['image/png', PNG],
    ['image/jpeg', JPEG],
    ['image/webp', WEBP],
  ] as const)('accepts %s with valid magic and sends a credential-free image request', async (contentType, bytes) => {
    mocks.logoTransport.mockResolvedValue(new Response(bytes, {
      headers: {
        'content-type': `${contentType}; charset=binary`,
        etag: '"safe-etag"',
        'last-modified': 'Tue, 21 Jul 2026 09:00:00 GMT',
        'set-cookie': 'session=secret',
        'content-security-policy': "default-src 'none'",
        location: 'https://attacker.example',
      },
    }))

    const result = await fetchReportLogo('https://cdn.example/logo')

    expect(result).toEqual({
      bytes,
      contentType,
      etag: '"safe-etag"',
      lastModified: 'Tue, 21 Jul 2026 09:00:00 GMT',
      cacheControl: REPORT_LOGO_CACHE_CONTROL,
    })
    const init = mocks.logoTransport.mock.calls[0]?.[1] as RequestInit
    const headers = new Headers(init.headers)
    expect(headers.get('accept')).toBe('image/png, image/jpeg, image/webp')
    expect(headers.get('user-agent')).toMatch(/Fimmick AISO Logo Fetcher/i)
    expect(init.credentials).toBe('omit')
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(result).not.toHaveProperty('headers')
  })

  it.each(['text/html', 'image/svg+xml', 'application/octet-stream', null])('rejects unapproved content type %s', async contentType => {
    const headers = contentType ? { 'content-type': contentType } : undefined
    mocks.logoTransport.mockResolvedValue(new Response('<svg/>', { headers }))
    await expect(fetchReportLogo('https://cdn.example/logo')).rejects.toThrow(/content type/i)
  })

  it.each([
    ['empty PNG', 'image/png', new Uint8Array()],
    ['arbitrary PNG', 'image/png', new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])],
    ['truncated PNG', 'image/png', PNG.slice(0, 7)],
    ['truncated JPEG', 'image/jpeg', JPEG.slice(0, 2)],
    ['mismatched JPEG', 'image/jpeg', PNG],
    ['truncated WebP container', 'image/webp', new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x20, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
    ])],
    ['wrong WebP marker', 'image/webp', new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00, 0x4e, 0x4f, 0x50, 0x45,
    ])],
  ] as const)('rejects %s despite its declared MIME type', async (_label, contentType, bytes) => {
    mocks.logoTransport.mockResolvedValue(new Response(bytes, { headers: { 'content-type': contentType } }))
    await expect(fetchReportLogo('https://cdn.example/logo')).rejects.toThrow(/signature|container|truncated|image/i)
  })

  it('rejects an oversized declared response before reading it', async () => {
    let pulled = false
    const stream = new ReadableStream<Uint8Array>({ pull() { pulled = true } }, { highWaterMark: 0 })
    mocks.logoTransport.mockResolvedValue(new Response(stream, {
      headers: { 'content-type': 'image/png', 'content-length': String(REPORT_LOGO_MAX_BYTES + 1) },
    }))

    await expect(fetchReportLogo('https://cdn.example/logo')).rejects.toThrow(/2 MiB|large/i)
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
    mocks.logoTransport.mockResolvedValue(new Response(stream, {
      headers: { 'content-type': 'image/png' },
    }))

    await expect(fetchReportLogo('https://cdn.example/logo')).rejects.toThrow(/2 MiB|large/i)
  })

  it('cancels a non-success response body before throwing', async () => {
    const cancel = vi.fn()
    const stream = new ReadableStream<Uint8Array>({ cancel }, { highWaterMark: 0 })
    mocks.logoTransport.mockResolvedValue(new Response(stream, { status: 502 }))

    await expect(fetchReportLogo('https://cdn.example/logo')).rejects.toThrow(/status 502/i)
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('drops unsafe validators instead of forwarding arbitrary upstream metadata', async () => {
    mocks.logoTransport.mockResolvedValue(new Response(PNG, {
      headers: {
        'content-type': 'image/png',
        etag: 'not-an-etag',
        'last-modified': 'not an HTTP date',
        'cache-control': 'public, max-age=31536000',
        vary: '*',
      },
    }))

    await expect(fetchReportLogo('https://cdn.example/logo')).resolves.toEqual({
      bytes: PNG,
      contentType: 'image/png',
      etag: null,
      lastModified: null,
      cacheControl: REPORT_LOGO_CACHE_CONTROL,
    })
  })
})
