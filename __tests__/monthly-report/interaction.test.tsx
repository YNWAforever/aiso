import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'

// Event-handler unit harness, not DOM/browser coverage; hooks retain state across explicit renders.
const h = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0, refresh: vi.fn() }))
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useState(initial: unknown) {
    const index = h.cursor++
    if (!(index in h.values)) h.values[index] = initial
    return [h.values[index], (next: unknown) => { h.values[index] = next }]
  },
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }))

import { MonthlyReportPublish } from '@/components/monthly-report/MonthlyReportPublish'
import { MonthlyReportEditor } from '@/components/monthly-report/MonthlyReportEditor'

type Element = ReactElement<Record<string, unknown> & { children?: ReactNode }>
function nodes(node: ReactNode): Element[] {
  return Children.toArray(node).flatMap(child => isValidElement(child)
    ? [child as Element, ...nodes((child as Element).props.children)] : [])
}
const clientId = '30000000-0000-4000-8000-000000000001', versionId = '50000000-0000-4000-8000-000000000001'
const link = 'https://fixture.example/en/r/public-fixture?v=1&s=fixture-signature'
const copyFor = (locale: string) => (locale === 'en' ? en : zh).monthlyReport
function publisher(locale = 'en', overrides: Partial<Parameters<typeof MonthlyReportPublish>[0]> = {}) {
  const t = copyFor(locale)
  h.cursor = 0
  return MonthlyReportPublish({ clientId, month: '2026-10', versionId, latestIsPublished: false, shareUrl: link,
    copy: { shared: t.shared, notShared: t.not_shared, shareLink: t.share_link, publish: t.publish_latest,
      revoke: t.revoke, failed: t.publish_failed, stale: t.stale }, ...overrides })
}
function editor(locale: 'en' | 'zh-HK') {
  const t = copyFor(locale)
  h.cursor = 0
  return MonthlyReportEditor({ clientId, month: '2026-10', locale, narrative: 'Keep my edited narrative.',
    copy: { language: t.language, narrative: t.narrative, save: t.save, failed: t.failed,
      brandingRequired: t.branding_required, invalidNarrative: t.invalid_narrative } })
}
function click(tree: ReactNode, label: string) {
  const button = nodes(tree).find(node => node.props.children === label && typeof node.props.onClick === 'function')!
  const onClick = button.props.onClick as () => void
  onClick()
}
const submit = (tree: Element) => (tree.props.onSubmit as (event: { preventDefault: () => void }) => void)({ preventDefault: () => {} })

beforeEach(() => { h.values = []; h.cursor = 0; h.refresh.mockReset() })

describe.each(['en', 'zh-HK'] as const)('monthly report interaction in %s', locale => {
  it.each([409, 503, 'network'] as const)('keeps the reviewed version and shows a safe publish error for %s', async failure => {
    const fetch = vi.fn()
    if (failure === 'network') fetch.mockRejectedValue(new Error('PRIVATE_NETWORK_SENTINEL'))
    else fetch.mockResolvedValue(new Response('PRIVATE_RESPONSE_SENTINEL', { status: failure }))
    vi.stubGlobal('fetch', fetch)
    click(publisher(locale), copyFor(locale).publish_latest)
    await vi.waitFor(() => expect(h.values[0]).toBe(false))
    expect(fetch).toHaveBeenCalledWith(`/api/clients/${clientId}/months/2026-10/report/publish`, expect.objectContaining({
      method: 'POST', body: JSON.stringify({ versionId }),
    }))
    const html = renderToStaticMarkup(publisher(locale))
    expect(html).toContain('role="alert"')
    expect(html).toContain(failure === 409 ? copyFor(locale).stale : copyFor(locale).publish_failed)
    expect(html).not.toContain('PRIVATE_')
    expect(h.refresh).not.toHaveBeenCalled()
    expect(html).toContain(link.replace(/&/g, '&amp;'))
  })

  it('disables publish and revoke while pending, refreshes on success, and renders a read-only share link', async () => {
    let finish!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { finish = resolve })))
    click(publisher(locale), copyFor(locale).publish_latest)
    const pending = nodes(publisher(locale)).filter(node => node.props.onClick)
    expect(pending).toHaveLength(2)
    expect(pending.every(node => node.props.disabled === true)).toBe(true)
    const input = nodes(publisher(locale)).find(node => node.type === 'input')!
    expect(input.props.readOnly).toBe(true)
    finish(Response.json({ shareUrl: link }))
    await vi.waitFor(() => expect(h.refresh).toHaveBeenCalledOnce())
    expect(h.values[0]).toBe(false)
    expect(nodes(publisher(locale)).filter(node => node.props.onClick).every(node => !node.props.disabled)).toBe(true)
  })

  it('shows revoke failures and permits a retry without a refresh', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error('PRIVATE_REVOKE_SENTINEL')).mockResolvedValueOnce(Response.json({ revoked: true }))
    vi.stubGlobal('fetch', fetch)
    click(publisher(locale), copyFor(locale).revoke)
    await vi.waitFor(() => expect(h.values[0]).toBe(false))
    expect(renderToStaticMarkup(publisher(locale))).toContain(copyFor(locale).publish_failed)
    expect(h.refresh).not.toHaveBeenCalled()
    click(publisher(locale), copyFor(locale).revoke)
    await vi.waitFor(() => expect(h.refresh).toHaveBeenCalledOnce())
    expect(fetch).toHaveBeenLastCalledWith(`/api/clients/${clientId}/months/2026-10/report/revoke`, expect.objectContaining({ method: 'POST', body: undefined }))
  })

  it.each(['BRANDING_REQUIRED', 'INVALID_NARRATIVE', 'unavailable', 'network'])('preserves the draft and surfaces save failure %s', async failure => {
    const fetch = vi.fn()
    if (failure === 'network') fetch.mockRejectedValue(new Error('PRIVATE_SAVE_SENTINEL'))
    else fetch.mockResolvedValue(Response.json({ error: failure }, { status: failure === 'unavailable' ? 503 : 409 }))
    vi.stubGlobal('fetch', fetch)
    submit(editor(locale) as Element)
    await vi.waitFor(() => expect(h.values[2]).toBe(false))
    const tree = editor(locale), html = renderToStaticMarkup(tree)
    const t = copyFor(locale)
    expect(html).toContain(failure === 'BRANDING_REQUIRED' ? t.branding_required : failure === 'INVALID_NARRATIVE' ? t.invalid_narrative : t.failed)
    expect(html).toContain('Keep my edited narrative.')
    expect(html).not.toContain('PRIVATE_')
    expect(h.refresh).not.toHaveBeenCalled()
    expect(fetch).toHaveBeenCalledWith(`/api/clients/${clientId}/months/2026-10/report`, expect.objectContaining({
      body: JSON.stringify({ locale, narrative: 'Keep my edited narrative.' }),
    }))
  })

  it('offers only revoke for an old published month and no actions for an already published latest version', () => {
    const old = renderToStaticMarkup(publisher(locale, { canPublish: false }))
    expect(old).toContain(copyFor(locale).revoke)
    expect(old).not.toContain(copyFor(locale).publish_latest)
    const current = renderToStaticMarkup(publisher(locale, { latestIsPublished: true, shareUrl: null }))
    expect(current).not.toContain('<button')
  })
})
