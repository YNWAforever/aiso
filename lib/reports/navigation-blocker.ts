const REPORT_NAVIGATION_STATE_KEY = '__geoscanner_report_navigation'
const REPORT_NAVIGATION_RESTORATION_TIMEOUT_MS = 1_000
const REPORT_NAVIGATION_MAX_RESTORATION_HOPS = 512
let reportNavigationOwnerSequence = 0

type ReportNavigationState = {
  owner: string
  point: 0 | 1
  url: string
  version: 1
}

type ReportNavigationBrowser = Pick<
  Window,
  'addEventListener' | 'clearTimeout' | 'removeEventListener' | 'setTimeout'
> & {
  history: Pick<
    History,
    'go' | 'length' | 'pushState' | 'replaceState' | 'state'
  >
  location: Pick<Location, 'assign' | 'href'>
  navigation?: {
    currentEntry: { index: number } | null
  }
}

type ReportNavigationRestoration = {
  canReverse: boolean
  direction: -1 | 1
  point: 0 | 1
  remainingHops: number
  timeoutId: number | null
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

function reportNavigationEntryIndex(
  browser: ReportNavigationBrowser,
): number | null {
  const index = browser.navigation?.currentEntry?.index
  return typeof index === 'number' && Number.isSafeInteger(index) && index >= 0
    ? index
    : null
}

function reportNavigationRestorationHopBudget(historyLength: number): number {
  const boundedLength = Number.isSafeInteger(historyLength) && historyLength > 0
    ? historyLength
    : 1
  return Math.min(
    boundedLength * 2 + 2,
    REPORT_NAVIGATION_MAX_RESTORATION_HOPS,
  )
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

  if (existingMarker) {
    activePoint = existingMarker.point
  } else {
    const baseMarker: ReportNavigationState = { owner, point: 0, url, version: 1 }
    browser.history.replaceState(
      withReportNavigationState(browser.history.state, baseMarker),
      '',
      url,
    )
    browser.history.pushState(
      withReportNavigationState(browser.history.state, { ...baseMarker, point: 1 }),
      '',
      url,
    )
    activePoint = 1
  }

  let activeEntryIndex = reportNavigationEntryIndex(browser)
  let restoration: ReportNavigationRestoration | null = null
  let passingOwnedBoundary = false

  const stopRestoration = () => {
    if (restoration && restoration.timeoutId !== null) {
      browser.clearTimeout(restoration.timeoutId)
    }
    restoration = null
  }

  const failOpenRestoration = () => {
    if (!restoration) return
    stopRestoration()
    // A full navigation keeps the visible URL and rendered route aligned even
    // if another script removed or rewrote the owned history entry.
    browser.location.assign(browser.location.href)
  }

  const continueRestoration = () => {
    if (!restoration) return
    if (restoration.remainingHops <= 0) {
      failOpenRestoration()
      return
    }

    restoration.remainingHops -= 1
    restoration.timeoutId = browser.setTimeout(() => {
      if (!restoration) return
      restoration.timeoutId = null
      if (!restoration.canReverse) {
        failOpenRestoration()
        return
      }

      // Classic PopStateEvent has no delta. If the adjacent-direction probe
      // made no progress, reverse once and scan the other side of the stack.
      restoration.canReverse = false
      restoration.direction = restoration.direction === 1 ? -1 : 1
      continueRestoration()
    }, REPORT_NAVIGATION_RESTORATION_TIMEOUT_MS)
    browser.history.go(restoration.direction)
  }

  const startRestoration = (
    point: 0 | 1,
    direction: -1 | 1,
    canReverse = false,
  ) => {
    stopRestoration()
    restoration = {
      canReverse,
      direction,
      point,
      remainingHops: reportNavigationRestorationHopBudget(browser.history.length),
      timeoutId: null,
    }
    continueRestoration()
  }

  const guardBrowserTraversal = (event: PopStateEvent) => {
    const marker = reportNavigationState(event.state, url)
    const currentEntryIndex = reportNavigationEntryIndex(browser)

    if (restoration) {
      if (restoration.timeoutId !== null) {
        browser.clearTimeout(restoration.timeoutId)
        restoration.timeoutId = null
      }

      if (marker?.owner === owner && marker.point === restoration.point) {
        activePoint = marker.point
        activeEntryIndex = currentEntryIndex
        stopRestoration()
        event.stopImmediatePropagation()
        return
      }

      // Neither unowned routes nor the other sentinel point may reach Next
      // while restoration walks toward the exact active owned entry.
      event.stopImmediatePropagation()
      continueRestoration()
      return
    }

    if (passingOwnedBoundary) {
      passingOwnedBoundary = false
      return
    }

    if (!marker || marker.owner !== owner) {
      if (!shouldBlock() || confirmLeave()) return

      const indexedDirection = activeEntryIndex !== null
        && currentEntryIndex !== null
        && activeEntryIndex !== currentEntryIndex
        ? activeEntryIndex > currentEntryIndex ? 1 : -1
        : null
      const direction = indexedDirection
        // Classic History exposes no traversal delta. Start with the established
        // adjacent direction, then reverse once on bounded no-progress.
        ?? (activePoint === 0 ? 1 : -1)

      event.stopImmediatePropagation()
      startRestoration(activePoint, direction, indexedDirection === null)
      return
    }

    if (marker.point === activePoint) return

    const previousPoint = activePoint
    const direction = marker.point - activePoint
    activePoint = marker.point
    activeEntryIndex = currentEntryIndex
    event.stopImmediatePropagation()

    if (shouldBlock() && !confirmLeave()) {
      startRestoration(previousPoint, direction < 0 ? 1 : -1)
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
  return () => {
    stopRestoration()
    browser.removeEventListener('popstate', guardBrowserTraversal, true)
  }
}
