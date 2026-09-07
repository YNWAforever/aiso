import { getTranslations } from 'next-intl/server'
import { requireAuth } from '@/lib/auth'
import { loadOwnedPortfolio } from '@/lib/workspace/load-owned-portfolio'
import { buildPortfolio } from '@/lib/view-models/portfolio'
import { PortfolioView } from '@/components/dashboard/PortfolioView'
import { AddBrandWizard } from '@/components/dashboard/AddBrandWizard'

export default async function DashboardPage({params}: {params:Promise<{lang:string}>}) {
  const {lang} = await params
  const profile = await requireAuth(lang)
  const t = await getTranslations({locale:lang,namespace:'portfolio'})
  let owned
  try {
    owned = await loadOwnedPortfolio({profile})
  } catch {
    return <main className="px-6 py-12"><h1 className="text-xl font-bold text-foreground">{t('loadErrorTitle')}</h1><p className="mt-3 text-sm text-muted-foreground">{t('loadErrorBody')}</p></main>
  }
  const portfolio = buildPortfolio(owned)
  const creationControl = portfolio.capacity.state === 'known' && portfolio.capacity.canCreate === true ? <AddBrandWizard lang={lang}/> : null
  return <PortfolioView portfolio={portfolio} lang={lang} creationControl={creationControl}/>
}
