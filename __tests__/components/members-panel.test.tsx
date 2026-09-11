import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import { MembersPanel, type MembersPanelProps } from '@/components/dashboard/MembersPanel'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'

const SELF = '22222222-2222-4222-8222-222222222222'
const OTHER = '44444444-4444-4444-4444-444444444444'

const baseProps: MembersPanelProps = {
  self: SELF,
  limit: 10,
  members: [
    { profileId: SELF, displayName: 'Owner', approver: false, joinedAt: '2026-09-01T00:00:00.000000Z' },
    { profileId: OTHER, displayName: 'Reviewer', approver: true, joinedAt: '2026-09-05T00:00:00.000000Z' },
  ],
  invitations: [],
}

function render(props: Partial<MembersPanelProps> = {}, lang = 'en') {
  return renderToString(
    <NextIntlClientProvider locale={lang} messages={lang === 'en' ? en : zh} timeZone="UTC">
      <MembersPanel {...baseProps} {...props} />
    </NextIntlClientProvider>,
  )
}

const STATUSES = ['pending', 'accepted', 'revoked', 'expired', 'unclaimable'] as const

function invitation(status: (typeof STATUSES)[number], index = 0) {
  return {
    id: `5555555${index}-5555-4555-8555-555555555555`,
    email: `invited-${index}@example.com`,
    status,
    invitedAt: '2026-09-10T00:00:00.000000Z',
    expiresAt: '2026-09-17T00:00:00.000000Z',
  }
}

describe('MembersPanel', () => {
  it.each(['en', 'zh-HK'])('marks which member is the viewer in %s', lang => {
    const html = render({}, lang)
    expect(html).toContain((lang === 'en' ? en : zh).members.you)
  })

  /**
   * The AC-14 connection, stated on the surface rather than left implicit.
   * `can_decide` needs a second member of the SAME account who is not the
   * submitter AND holds a live approver grant, so a workspace can have two
   * members and still be unable to approve anything. Showing membership
   * without showing that would look like the job was finished.
   */
  it.each(['en', 'zh-HK'])('says who may approve and who may not, in %s', lang => {
    const html = render({}, lang)
    const copy = (lang === 'en' ? en : zh).members
    expect(html).toContain(copy.approver)
    expect(html).toContain(copy.notApprover)
  })

  it.each(['en', 'zh-HK'])('renders every invitation status in %s', lang => {
    const html = render(
      { invitations: STATUSES.map((status, index) => invitation(status, index)) },
      lang,
    )
    const copy = (lang === 'en' ? en : zh).members
    for (const status of STATUSES) expect(html).toContain(copy.status[status])
  })

  /**
   * A missing translation falls back to English silently, so identical output
   * in both languages is the symptom to test for. AC-15 asks the same of every
   * other surface built here.
   */
  it('gives each status a different string in each language', () => {
    for (const status of STATUSES) {
      expect(en.members.status[status]).not.toBe(zh.members.status[status])
    }
  })

  /**
   * `unclaimable` is the one status a reader cannot guess. The address already
   * has an auth user, so provisioning can never consume the invitation — the
   * panel has to say that rather than leave it looking like a slow `pending`.
   */
  it.each(['en', 'zh-HK'])('explains why an unclaimable invitation cannot arrive, in %s', lang => {
    const html = render({ invitations: [invitation('unclaimable')] }, lang)
    expect(html).toContain((lang === 'en' ? en : zh).members.unclaimableHelp)
  })

  it('offers a revoke control only for an invitation that can still be withdrawn', () => {
    expect(render({ invitations: [invitation('pending')] })).toContain(en.members.revoke)
    expect(render({ invitations: [invitation('accepted')] })).not.toContain(en.members.revoke)
  })

  it.each(['en', 'zh-HK'])('refuses further invitations at the cap and says why, in %s', lang => {
    const full = Array.from({ length: 10 }, (_, index) => ({
      profileId: `6666666${index}-6666-4666-8666-666666666666`,
      displayName: `Member ${index}`,
      approver: false,
      joinedAt: '2026-09-01T00:00:00.000000Z',
    }))
    const html = render({ members: full }, lang)
    expect(html).toContain((lang === 'en' ? en : zh).members.capReached)
    expect(html).toContain('disabled')
  })

  /**
   * Review happens on a phone (AC-14), so every control has to clear a finger.
   * `min-h-11` is 44px in this Tailwind scale — the floor the rest of the owner
   * surfaces are held to.
   */
  it.each(['en', 'zh-HK'])('gives every control a touch-sized target in %s', lang => {
    const html = render({ invitations: [invitation('pending')] }, lang)
    const controls = html.match(/<(button|input)\b[^>]*>/g) ?? []
    expect(controls.length).toBeGreaterThan(0)
    for (const control of controls) expect(control).toMatch(/min-h-1[12]/)
  })

  it('labels the address field rather than relying on a placeholder', () => {
    const html = render()
    expect(html).toContain('<label')
    expect(html).toContain(en.members.emailLabel)
  })
})
