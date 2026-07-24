const REPORT_NAVIGATION_STATE_KEY = '__geoscanner_report_navigation'
let reportNavigationOwnerSequence = 0

type ReportNavigationState = {
  owner: string
  point: 0 | 1
  url: string
  version: 1
}

type ReportNavigationBrowser = Pick<
  Window,
  'addEventListener' | 'removeEventListener'
> & {
  history: Pick<History, 'go' | 'pushState' | 'replaceState' | 'state'>
  location: Pick<Location, 'href'>
}

function reportNavigationState(
  state: unknown,
  url: string,
): ReportNavigationState | null {
  if (!state || typeof state !== 'object') return null
  const marker = (state as Record<string, unknown>)[REPORT_NAVIGATION_STATE_KEY]
  if (!marker || typeof marker !== 'object') return null
  const candidate = marker as Partial<ReportNavigationState>
  return candidate.version === 1
    && typeof candidate.owner === 'string'
    && (candidate.point === 0 || candidate.point === 1)
    && candidate.url === url
    ? candidate as ReportNavigationState
    : null
}

function withReportNavigationState(
  state: unknown,
  marker: ReportNavigationState,
): Record<string, unknown> {
  const currentState = state && typeof state === 'object'
    ? state as Record<string, unknown>
    : {}
  return { ...currentState, [REPORT_NAVIGATION_STATE_KEY]: marker }
}

export function installReportNavigationBlocker({
  browser,
  confirmLeave,
  shouldBlock,
}: {
  browser: ReportNavigationBrowser
  confirmLeave: () => boolean
  shouldBlock: () => boolean
}): () => void {
  const url = browser.location.href
  const existingMarker = reportNavigationState(browser.history.state, url)
  const owner = existingMarker?.owner
    ?? `report-navigation-${Date.now()}-${++reportNavigationOwnerSequence}`
  let activePoint: 0 | 1

  if (existingMarker?.point === 1) {
    activePoint = 1
  } else {
    const baseMarker: ReportNavigationState = { owner, point: 0, url, version: 1 }
    if (!existingMarker) {
      browser.history.replaceState(
        withReportNavigationState(browser.history.state, baseMarker),
        '',
        url,
      )
    }
    browser.history.pushState(
      withReportNavigationState(browser.history.state, { ...baseMarker, point: 1 }),
      '',
      url,
    )
    activePoint = 1
  }

  let expectedRestorationPoint: 0 | 1 | null = null
  let passingOwnedBoundary = false

  const guardBrowserTraversal = (event: PopStateEvent) => {
    const marker = reportNavigationState(event.state, url)

    if (expectedRestorationPoint !== null
      && marker?.owner === owner
      && marker.point === expectedRestorationPoint) {
      activePoint = marker.point
      expectedRestorationPoint = null
      event.stopImmediatePropagation()
      return
    }

    if (passingOwnedBoundary) {
      passingOwnedBoundary = false
      return
    }

    if (!marker || marker.owner !== owner || marker.point === activePoint) return

    const direction = marker.point - activePoint
    activePoint = marker.point
    event.stopImmediatePropagation()

    if (shouldBlock() && !confirmLeave()) {
      expectedRestorationPoint = direction < 0 ? 1 : 0
      browser.history.go(-direction)
      return
    }

    // The first traversal only crosses our same-URL sentinel. Skip the paired
    // entry and let the next popstate reach Next so it sees one real departure.
    passingOwnedBoundary = true
    browser.history.go(direction)
  }

  // Capture runs before Next's router listener even though the router mounted
  // first. Canceled/intermediate traversals therefore cannot unmount the builder.
  browser.addEventListener('popstate', guardBrowserTraversal, true)
  return () => browser.removeEventListener('popstate', guardBrowserTraversal, true)
}
