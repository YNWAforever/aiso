import { Resend } from 'resend'
import { appOrigin } from '@/lib/app-origin'

/**
 * Tell someone they have been invited into an account.
 *
 * There is no accept link and no token, because there is nothing to click:
 * the invitation is consumed when this address signs in for the first time
 * (migration 047, and `provisionAccountForUser`). The mail carries a plain
 * sign-in URL, so a forwarded copy grants nothing — whoever receives it still
 * has to prove control of the invited address through Neon Auth.
 *
 * A failure here does NOT invalidate the invitation, so the caller reports
 * `emailed: false` rather than unwinding the row; the member can pass the
 * address on another way. Throwing is still right: the caller must be able to
 * tell "sent" from "not sent", and a silent success would have it report that
 * somebody had been told when nobody had.
 */
export async function sendInvitationEmail({
  to,
  accountName,
  invitedBy,
  locale,
}: {
  to: string
  accountName: string | null
  invitedBy: string | null
  locale: 'en' | 'zh-HK'
}) {
  const resend = new Resend(process.env.RESEND_API_KEY)
  const signInUrl = `${appOrigin()}/${locale}/auth/login`
  const workspace = accountName?.trim() || (locale === 'zh-HK' ? '一個 AISO 工作區' : 'an AISO workspace')
  const inviter = invitedBy?.trim() || (locale === 'zh-HK' ? '一位成員' : 'a member')

  const subject = locale === 'zh-HK'
    ? `${inviter} 邀請你加入 ${workspace}`
    : `${inviter} invited you to ${workspace}`

  const body = locale === 'zh-HK'
    ? [
        `${inviter} 邀請你以 ${to} 加入 ${workspace}。`,
        '',
        `用這個電郵地址登入即可加入，毋須接受任何連結：${signInUrl}`,
        '',
        '如果你用其他電郵地址登入，你會開設自己的帳戶，而不會加入這個工作區。',
        '邀請會在七日後失效。',
      ].join('\n')
    : [
        `${inviter} invited you to join ${workspace} as ${to}.`,
        '',
        `Sign in with this address to join — there is nothing to accept: ${signInUrl}`,
        '',
        'Signing in with a different address starts your own account rather than joining this one.',
        'The invitation expires in seven days.',
      ].join('\n')

  const { error } = await resend.emails.send({
    // See sendAlertEmail below: `??` keeps '', which Resend rejects.
    from: process.env.RESEND_FROM_EMAIL?.trim() || 'alerts@fimmick-aeo.com',
    to,
    subject,
    text: body,
  })

  if (error) {
    throw new Error('Resend invitation email failed', { cause: error })
  }
}

export async function sendAlertEmail({
  to,
  brandName,
  type,
  currentSov,
  previousSov,
  threshold,
  dashboardUrl,
}: {
  to: string
  brandName: string
  type: 'sov_threshold' | 'sov_wow_drop' | 'sov_recovery'
  currentSov: number
  previousSov?: number
  threshold: number
  dashboardUrl: string
}) {
  const resend = new Resend(process.env.RESEND_API_KEY)
  const isRecovery = type === 'sov_recovery'
  const subject    = isRecovery
    ? `✅ SoV Recovered — ${brandName}`
    : `⚠️ SoV Alert — ${brandName}`

  const body = type === 'sov_threshold'
    ? `${brandName} Share of Voice fell below ${threshold}%.\nCurrent: ${currentSov}%\nView dashboard: ${dashboardUrl}`
    : type === 'sov_wow_drop'
    ? `${brandName} SoV dropped ${previousSov !== undefined ? previousSov - currentSov : '?'} points this week.\nCurrent: ${currentSov}% (was ${previousSov}%)\nThreshold: ${threshold} points\nView dashboard: ${dashboardUrl}`
    : `${brandName} SoV recovered above ${threshold}%.\nCurrent: ${currentSov}%\nView dashboard: ${dashboardUrl}`

  const { error } = await resend.emails.send({
    // `?.trim() ||`, not `??`: nullish coalescing keeps '', and a deploy
    // environment declaring the variable without a value supplies exactly that.
    // An empty `from` is not a degraded send, it is a rejected one -- and this
    // is the alert path, so the failure would be invisible until someone
    // noticed alerts had stopped. Same reasoning as lib/app-origin.ts.
    from:    process.env.RESEND_FROM_EMAIL?.trim() || 'alerts@fimmick-aeo.com',
    to,
    subject,
    text: body,
  })

  if (error) {
    throw new Error('Resend alert email failed', { cause: error })
  }
}

export async function sendTrialEmail({
  to,
  subject,
  text,
}: {
  to: string
  subject: string
  text: string
}) {
  const resend = new Resend(process.env.RESEND_API_KEY)

  const { error } = await resend.emails.send({
    // See sendAlertEmail above: `??` keeps '', which Resend rejects.
    from: process.env.RESEND_TRIAL_FROM_EMAIL?.trim() || 'hello@fimmick-aeo.com',
    to,
    subject,
    text,
  })

  if (error) {
    throw new Error('Resend trial email failed', { cause: error })
  }
}
