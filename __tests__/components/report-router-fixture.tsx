import { AppRouterContext, type AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime'

// Only the component fixture transport is synthetic. Real Next router cache
// invalidation is covered separately by tests/local-auth/report-list.spec.mjs.
const router: AppRouterInstance = {
  bfcacheId: 'synthetic-report-fixture',
  refresh() {},
  prefetch() {},
  back() { window.history.back() },
  forward() { window.history.forward() },
  push(url) { window.location.assign(url) },
  replace(url) { window.location.replace(url) },
}
export function ReportRouterFixture({ children }: { children: React.ReactNode }) {
  return <AppRouterContext.Provider value={router}>{children}</AppRouterContext.Provider>
}
