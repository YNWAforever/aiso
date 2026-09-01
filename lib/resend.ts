import { Resend } from 'resend'

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
