import type { CheckResult } from '@/lib/types'

const ICONS = { pass: '✅', warn: '⚠️', fail: '❌' }
const COLORS = {
  pass: 'text-green-700',
  warn: 'text-amber-700',
  fail: 'text-red-700',
}

interface Props {
  label: string
  result: CheckResult
  message: string
}

export function CheckItem({ label, result, message }: Props) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
      <span className="text-sm text-slate-700">{label}</span>
      <div className="flex items-center gap-2">
        <span className={`text-sm ${COLORS[result.status]}`}>{message}</span>
        <span>{ICONS[result.status]}</span>
      </div>
    </div>
  )
}
