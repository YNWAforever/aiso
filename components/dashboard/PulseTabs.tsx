'use client'
import { useSearchParams, usePathname, useRouter } from 'next/navigation'

const TABS = [
  { id: 'overview',    label: 'Overview' },
  { id: 'platforms',   label: 'Platforms' },
  { id: 'missed',      label: 'Missed' },
  { id: 'competitors', label: 'Competitors' },
  { id: 'alerts',      label: 'Alerts' },
] as const

export type TabId = typeof TABS[number]['id']

export function PulseTabs() {
  const searchParams = useSearchParams()
  const pathname     = usePathname()
  const router       = useRouter()
  const activeTab    = (searchParams.get('tab') ?? 'overview') as TabId

  const navigate = (tab: TabId) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', tab)
    router.push(`${pathname}?${params.toString()}`)
  }

  return (
    <div className="bg-card border-b px-6 flex gap-0">
      {TABS.map(({ id, label }) => (
        <button key={id} onClick={() => navigate(id)}
          className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
            activeTab === id
              ? 'text-primary border-primary'
              : 'text-muted-foreground border-transparent hover:text-foreground'
          }`}>
          {label}
        </button>
      ))}
    </div>
  )
}
