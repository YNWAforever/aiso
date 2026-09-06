import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import { VersionWorkspace } from '@/components/change-sets/VersionWorkspace'
import { VersionDetails } from '@/components/change-sets/VersionDetails'
import { DraftEditor } from '@/components/work-items/DraftEditor'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'
import { draft, clientId, version, initial } from './c9d-fixtures'
const render = (node: React.ReactNode, lang = 'en') =>
  renderToString(
    <NextIntlClientProvider
      locale={lang}
      messages={lang === 'en' ? en : zh}
      timeZone="UTC"
    >
      {node}
    </NextIntlClientProvider>,
  )
describe('change set rendering', () => {
  it.each(['en', 'zh-HK'])(
    'shows persisted draft submission and immutable package separately in %s',
    (lang) => {
      const html = render(
        <VersionWorkspace
          clientId={clientId}
          workItemId={draft.id}
          initialDraft={draft}
          initial={initial}
          initialVersion={version}
        />,
        lang,
      )
      expect(html).toContain(
        'Frozen &lt;script&gt;alert(1)&lt;/script&gt; 版本',
      )
      expect(html).toContain('Recorded title')
      expect(html).not.toContain('<script>')
      expect(html).toContain('change-set-review.v1')
      expect(html).toContain('type="submit"')
    },
  )
  it('never offers submission without a persisted draft', () => {
    const html = render(
      <VersionWorkspace
        clientId={clientId}
        workItemId={draft.id}
        initialDraft={null}
        initial={null}
        initialError="unavailable"
      />,
    )
    expect(html).toContain('role="alert"')
    expect(html).not.toContain('type="submit"')
  })
  it.each(['self', 'revoked', 'non-approver'])(
    'does not offer decisions when API denies %s',
    () => {
      const html = render(
        <VersionDetails
          version={{ ...version, capabilities: { canDecide: false } }}
          latestVersionId={version.id}
        />,
      )
      expect(html).not.toContain('textarea')
      expect(html).toContain('independent')
    },
  )
  it('marks superseded immutable content', () => {
    const html = render(
      <VersionDetails version={version} latestVersionId="new" />,
    )
    expect(html).toContain('Superseded')
    expect(html).toContain('Frozen notes')
  })
  it('saved editor links to version history', () =>
    expect(
      render(
        <DraftEditor clientId={clientId} item={draft} onSaved={() => {}} />,
      ),
    ).toContain(`/en/dashboard/${clientId}/work-items/${draft.id}/versions`))
})

import { afterAll } from 'vitest'
import { writeC9cFixture } from './c9c-fixture-writer'
const fixtureProps = {
  clientId,
  workItemId: draft.id,
  initialDraft: draft,
  initial,
  initialVersion: version,
}
const unavailableProps = {
  ...fixtureProps,
  initialDraft: null,
  initial: null,
  initialVersion: null,
  initialError: 'unavailable',
}
const revokedProps = {
  ...fixtureProps,
  initialVersion: { ...version, capabilities: { canDecide: false } },
}
afterAll(() =>
  writeC9cFixture(
    'C9D',
    'VersionWorkspace',
    '@/components/change-sets/VersionWorkspace',
    fixtureProps,
    (lang) => render(<VersionWorkspace {...fixtureProps} />, lang),
    {
      unavailable: {
        props: unavailableProps,
        html: (lang) =>
          render(<VersionWorkspace {...unavailableProps} />, lang),
      },
      revoked: {
        props: revokedProps,
        html: (lang) => render(<VersionWorkspace {...revokedProps} />, lang),
      },
    },
    'changeSets',
  ),
)
