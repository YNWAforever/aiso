import { getPlanDefinition } from '@/lib/plans/catalog'

// The original account bitmask is also honored by the delivery ledger.
export const EMAIL_DAY1 = 1
export const EMAIL_DAY5 = 2
export const EMAIL_DAY7 = 4
export const EMAIL_DAY10 = 8
export type TrialEmailBit = typeof EMAIL_DAY1 | typeof EMAIL_DAY5 | typeof EMAIL_DAY7 | typeof EMAIL_DAY10

export function buildTrialEmail(bit: TrialEmailBit, expiry: string | Date, locale: 'en' | 'zh-HK', appUrl: string) {
  const chinese = locale === 'zh-HK'
  const timeZone = chinese ? 'Asia/Hong_Kong' : 'UTC'
  const deadline = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium', timeStyle: 'short', timeZone,
  }).format(new Date(expiry))
  const price = getPlanDefinition('basic').monthlyPriceUsd
  const dashboard = `${appUrl}/${locale}/dashboard`
  const pricing = `${appUrl}/${locale}/pricing`
  if (bit === EMAIL_DAY1) return chinese ? {
    subject: '你的 AISO 免費試用已開始',
    text: `你可以在工作區查看掃描結果和建議的改善項目。試用將於 ${deadline}（香港時間）結束。\n\n${dashboard}\n\n— Fimmick AISO`,
  } : {
    subject: 'Your AISO trial is active',
    text: `Open your workspace to review your scan and suggested improvements. Your trial ends on ${deadline} UTC.\n\n${dashboard}\n\n— Fimmick AISO`,
  }
  if (bit === EMAIL_DAY10) return chinese ? {
    subject: '你的 AISO 免費試用已結束',
    text: `你仍可登入查看帳戶。如想繼續使用付費功能，請比較方案。\n\n${dashboard}\n${pricing}\n\n— Fimmick AISO`,
  } : {
    subject: 'Your AISO trial has ended',
    text: `You can still sign in to your account. Compare plans if you’d like to continue with a paid subscription.\n\n${dashboard}\n${pricing}\n\n— Fimmick AISO`,
  }
  const lastDay = bit === EMAIL_DAY7
  return chinese ? {
    subject: lastDay ? '你的 AISO 免費試用將於 24 小時內結束' : '你的 AISO 免費試用即將結束',
    text: `試用將於 ${deadline}（香港時間）結束。基本版每月 ${price} 美元。選購付費訂閱時，首次費用會在完成結帳時收取。\n\n${pricing}\n\n— Fimmick AISO`,
  } : {
    subject: lastDay ? 'Your AISO trial ends within 24 hours' : 'Your AISO trial is ending soon',
    text: `Your trial ends on ${deadline} UTC. Basic costs USD ${price} per month. Your first charge occurs when you complete checkout.\n\n${pricing}\n\n— Fimmick AISO`,
  }
}
