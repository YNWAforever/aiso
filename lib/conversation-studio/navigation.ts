import { buildDashboardNav, type NavFeatures, type NavItem } from '@/lib/dashboard-nav'

/** Existing destinations and visibility rules; no hidden Monitor advertising. */
export function buildStudioTools({ lang, clientId, features, admin }: { lang: string; clientId: string; features: NavFeatures; admin: boolean }): NavItem[] {
  const nav = buildDashboardNav({ lang, clientId, features })
  const item = (section: string, key?: string) => {
    const group = nav.find(s => s.key === section)
    return key ? group?.items.find(i => i.key === key) : group && { key: group.key, labelKey: group.labelKey, href: group.href }
  }
  return [item('overview'), item('scan', 'scan'), item('scan', 'results'), item('scan', 'improve'),
    item('monitor', 'monitor'), { key: 'roi', labelKey: 'local_visibility', href: `/${lang}/dashboard/${clientId}?step=roi` },
    item('settings', 'entities'), item('scan', 'opportunities'), item('monitor', 'observations'), item('settings', 'sources'),
    item('monitor', 'prompts'), item('monitor', 'competitors'), item('monitor', 'citations'), item('reports'), item('settings', 'account'),
    ...(admin ? [{ key: 'admin', labelKey: 'admin', href: `/admin?lang=${lang}` }] : []),
  ].filter((entry): entry is NavItem => Boolean(entry))
}
