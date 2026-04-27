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
    <div className="bg-white border-b border-slate-200 px-6 flex gap-0">
      {TABS.map(({ id, label }) => (
        <button key={id} onClick={() => navigate(id)}
          className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
            activeTab === id ? 'text-blue-600 border-blue-600' : 'text-slate-500 border-transparent hover:text-slate-800'
          }`}>
          {label}
        </button>
      ))}
    </div>
  )
}
