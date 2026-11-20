import { useTranslations } from 'next-intl'
import type { CollectorAccess } from '@/lib/types'

export function CrawlerAccessEvidence({ entries, kind }: { entries: readonly CollectorAccess[]; kind: 'policy' | 'probe' }) {
  const t = useTranslations('resultPage.crawler')
  if (!entries.length) return null
  return (
    <div className="space-y-1" data-testid={`crawler-${kind}-evidence`}>
      <p className="text-xs font-semibold text-foreground">{t(kind)}</p>
      <ul className="grid gap-1 text-xs text-muted-foreground">
        {entries.map(({ crawler, role, policy, probe }) => (
          <li key={crawler} className="break-words">
            {crawler} · {t(`role.${role}`)} · {kind === 'policy' ? t(`status.${policy}`) : t(`status.${probe}`)}
          </li>
        ))}
      </ul>
    </div>
  )
}
