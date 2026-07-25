import { getTranslations } from 'next-intl/server'

export default async function ClientReportsLoading() {
  const t = await getTranslations('reports')

  return (
    <main
      className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6"
      role="status"
      aria-busy="true"
    >
      <span className="sr-only">{t('loading')}</span>
      <div className="animate-pulse space-y-6 motion-reduce:animate-none" aria-hidden="true">
        <div className="space-y-3">
          <div className="h-4 w-32 rounded bg-muted" />
          <div className="h-8 w-64 max-w-full rounded bg-muted" />
          <div className="h-4 w-full max-w-xl rounded bg-muted" />
        </div>
        <div className="space-y-4">
          {[0, 1, 2].map(item => (
            <div key={item} className="rounded-xl border border-border p-6">
              <div className="h-5 w-48 max-w-full rounded bg-muted" />
              <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
                {[0, 1, 2, 3].map(metric => (
                  <div key={metric} className="h-12 rounded bg-muted" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}
