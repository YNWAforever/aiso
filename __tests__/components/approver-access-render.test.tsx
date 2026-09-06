import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import { ApproverAccessWorkspace } from '@/components/approvals/ApproverAccessWorkspace'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'
import { access, clientId } from './c9d-fixtures'
const render = (initial: typeof access | null, verified = true, lang = 'en') =>
  renderToString(
    <NextIntlClientProvider
      locale={lang}
      messages={lang === 'en' ? en : zh}
      timeZone="UTC"
    >
      <ApproverAccessWorkspace
        accountId={clientId}
        initial={initial}
        verified={verified}
      />
    </NextIntlClientProvider>,
  )
describe('approver access rendering', () => {
  it.each(['en', 'zh-HK'])(
    'renders escaped selectable members and labelled reason in %s',
    (lang) => {
      const html = render(access, true, lang)
      expect(html).toContain('Member &lt;script&gt;test&lt;/script&gt; 成員')
      expect(html).toContain('<label')
      expect(html).toContain('textarea')
    },
  )
  it('distinguishes zero active approvers from failed permissions', () => {
    expect(render(access)).toContain('No active approvers')
    const unavailable = render(null, false)
    expect(unavailable).toContain('role="alert"')
    expect(unavailable).not.toContain('No active approvers')
    expect(unavailable).not.toContain('textarea')
  })
  it('hides mutation controls without verified authority', () =>
    expect(render(access, false)).not.toContain('textarea'))
})

import { afterAll } from 'vitest'
import { writeC9cFixture } from './c9c-fixture-writer'
afterAll(() =>
  writeC9cFixture(
    'C9D_APPROVERS',
    'ApproverAccessWorkspace',
    '@/components/approvals/ApproverAccessWorkspace',
    { accountId: clientId, initial: access, verified: true },
    (lang) => render(access, true, lang),
    {
      unavailable: {
        props: { accountId: clientId, initial: null, verified: false },
        html: (lang) => render(null, false, lang),
      },
    },
    'approverAccess',
  ),
)
