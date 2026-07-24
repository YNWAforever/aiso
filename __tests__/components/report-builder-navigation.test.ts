import { describe, expect, it } from 'vitest'

type PopStateListener = (event: RuntimePopStateEvent) => void
type NavigationBlockerInstaller = (options: {
  browser: RuntimeBrowser
  confirmLeave: () => boolean
  shouldBlock: () => boolean
}) => () => void

class RuntimePopStateEvent extends Event {
  immediatePropagationStopped = false

  constructor(readonly state: unknown) {
    super('popstate')
  }

  override stopImmediatePropagation() {
    this.immediatePropagationStopped = true
    super.stopImmediatePropagation()
  }
}

class RuntimeBrowser {
  private entries: Array<{ state: unknown; url: string }>
  private index: number
  private readonly captureListeners: PopStateListener[] = []
  private readonly bubbleListeners: PopStateListener[] = []
  private pendingTraversals = 0

  readonly location = { href: '' }

  readonly history = {
    state: null as unknown,
    replaceState: (state: unknown, _unused: string, url?: string | URL | null) => {
      const currentUrl = url === undefined || url === null
        ? this.location.href
        : new URL(url, this.location.href).href
      this.entries[this.index] = { state, url: currentUrl }
      this.history.state = state
      this.location.href = currentUrl
    },
    pushState: (state: unknown, _unused: string, url?: string | URL | null) => {
      const currentUrl = url === undefined || url === null
        ? this.location.href
        : new URL(url, this.location.href).href
      this.entries.splice(this.index + 1)
      this.entries.push({ state, url: currentUrl })
      this.index = this.entries.length - 1
      this.history.state = state
      this.location.href = currentUrl
    },
    go: (delta: number) => {
      const targetIndex = this.index + delta
      if (targetIndex < 0 || targetIndex >= this.entries.length) return
      this.pendingTraversals += 1
      queueMicrotask(() => {
        this.index = targetIndex
        const entry = this.entries[this.index]
        this.history.state = entry.state
        this.location.href = entry.url
        this.dispatchPopState(new RuntimePopStateEvent(entry.state))
        this.pendingTraversals -= 1
      })
    },
    back: () => this.history.go(-1),
    forward: () => this.history.go(1),
  }

  constructor(entries: Array<{ state: unknown; url: string }>, index: number) {
    this.entries = entries.map(entry => ({ ...entry }))
    this.index = index
    this.history.state = this.entries[index].state
    this.location.href = this.entries[index].url
  }

  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ) {
    if (type !== 'popstate' || typeof listener !== 'function') return
    const capture = typeof options === 'boolean' ? options : options?.capture === true
    ;(capture ? this.captureListeners : this.bubbleListeners).push(listener as PopStateListener)
  }

  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ) {
    if (type !== 'popstate' || typeof listener !== 'function') return
    const capture = typeof options === 'boolean' ? options : options?.capture === true
    const listeners = capture ? this.captureListeners : this.bubbleListeners
    const index = listeners.indexOf(listener as PopStateListener)
    if (index !== -1) listeners.splice(index, 1)
  }

  async settle() {
    do {
      await new Promise<void>(resolve => setImmediate(resolve))
    } while (this.pendingTraversals > 0)
  }

  snapshot() {
    return {
      entries: this.entries.map(entry => ({ ...entry })),
      index: this.index,
    }
  }

  private dispatchPopState(event: RuntimePopStateEvent) {
    for (const listener of this.captureListeners) {
      listener(event)
      if (event.immediatePropagationStopped) return
    }
    for (const listener of this.bubbleListeners) {
      listener(event)
      if (event.immediatePropagationStopped) return
    }
  }
}


async function loadNavigationBlocker() {
  const reportBuilder = await import('@/components/reports/ReportBuilder')
  const installReportNavigationBlocker = (
    reportBuilder as unknown as {
      installReportNavigationBlocker?: NavigationBlockerInstaller
    }
  ).installReportNavigationBlocker

  expect(installReportNavigationBlocker).toBeTypeOf('function')
  return installReportNavigationBlocker
}

function createMountedBuilderRuntime() {
  const reportUrl = 'https://app.example/en/dashboard/client-1/reports/new'
  const runtime = new RuntimeBrowser([
    { state: { __NA: true }, url: 'https://app.example/en/dashboard/client-1/reports' },
    { state: { __NA: true }, url: reportUrl },
  ], 1)
  const builder = {
    edit: 'Saved executive summary',
    mounted: true,
    routeLeaves: 0,
  }

  // Next's router listener is registered before the component effect. The
  // runtime still dispatches capture listeners first, matching the DOM.
  runtime.addEventListener('popstate', () => {
    if (runtime.location.href === reportUrl) return
    builder.mounted = false
    builder.routeLeaves += 1
  })

  return { builder, reportUrl, runtime }
}

function reportNavigationPoint(state: unknown): 0 | 1 | null {
  if (!state || typeof state !== 'object') return null
  const marker = (state as Record<string, unknown>).__geoscanner_report_navigation
  if (!marker || typeof marker !== 'object') return null
  const point = (marker as Record<string, unknown>).point
  return point === 0 || point === 1 ? point : null
}

function createRemountingBuilderRuntime({
  confirmLeave,
  installReportNavigationBlocker,
}: {
  confirmLeave: () => boolean
  installReportNavigationBlocker: NavigationBlockerInstaller
}) {
  const previousUrl = 'https://app.example/en/dashboard/client-1/reports'
  const reportUrl = 'https://app.example/en/dashboard/client-1/reports/new'
  const nextUrl = 'https://app.example/en/dashboard/client-1/overview'
  const runtime = new RuntimeBrowser([
    { state: { __NA: true, route: 'A' }, url: previousUrl },
    { state: { __NA: true, route: 'B' }, url: reportUrl },
  ], 1)
  const builder = {
    dirty: false,
    edit: 'Saved executive summary',
    mounted: false,
    mounts: 0,
    routeLeaves: 0,
  }
  let removeNavigationBlocker: (() => void) | null = null

  const mount = () => {
    if (builder.mounted) return
    builder.mounted = true
    builder.mounts += 1
    removeNavigationBlocker = installReportNavigationBlocker({
      browser: runtime,
      confirmLeave,
      shouldBlock: () => builder.dirty,
    })
  }
  const unmount = () => {
    if (!builder.mounted) return
    removeNavigationBlocker?.()
    removeNavigationBlocker = null
    builder.mounted = false
    builder.routeLeaves += 1
  }

  // Next's popstate listener is registered before the component effect.
  runtime.addEventListener('popstate', () => {
    if (runtime.location.href === reportUrl) {
      mount()
      return
    }
    unmount()
  })
  mount()

  return {
    builder,
    cleanup: () => removeNavigationBlocker?.(),
    navigateToNextRoute: () => {
      runtime.history.pushState({ __NA: true, route: 'C' }, '', nextUrl)
      unmount()
    },
    nextUrl,
    previousUrl,
    reportUrl,
    runtime,
  }
}

describe('ReportBuilder browser-history navigation guard', () => {
  it('rejects one Back prompt while preserving the URL, mounted builder, and dirty edit', async () => {
    const installReportNavigationBlocker = await loadNavigationBlocker()
    if (!installReportNavigationBlocker) return
    const { builder, reportUrl, runtime } = createMountedBuilderRuntime()
    let prompts = 0
    let dirty = false
    const options = {
      browser: runtime,
      shouldBlock: () => dirty,
      confirmLeave: () => {
        prompts += 1
        return false
      },
    }
    const cleanupCleanBlocker = installReportNavigationBlocker(options)

    builder.edit = 'Unsaved executive summary edit'
    dirty = true
    cleanupCleanBlocker()
    const cleanup = installReportNavigationBlocker(options)

    runtime.history.back()
    await runtime.settle()

    expect(prompts).toBe(1)
    expect(runtime.location.href).toBe(reportUrl)
    expect(builder).toEqual({
      edit: 'Unsaved executive summary edit',
      mounted: true,
      routeLeaves: 0,
    })
    cleanup()
  })

  it('accepts one Back prompt and exposes the previous route exactly once', async () => {
    const installReportNavigationBlocker = await loadNavigationBlocker()
    if (!installReportNavigationBlocker) return
    const { builder, runtime } = createMountedBuilderRuntime()
    let prompts = 0
    const cleanup = installReportNavigationBlocker({
      browser: runtime,
      shouldBlock: () => true,
      confirmLeave: () => {
        prompts += 1
        return true
      },
    })

    runtime.history.back()
    await runtime.settle()

    expect(prompts).toBe(1)
    expect(runtime.location.href).toBe(
      'https://app.example/en/dashboard/client-1/reports',
    )
    expect(builder.mounted).toBe(false)
    expect(builder.routeLeaves).toBe(1)
    cleanup()
  })

  it('preserves the owned report pair and C when Forward remounts B point 0', async () => {
    const installReportNavigationBlocker = await loadNavigationBlocker()
    if (!installReportNavigationBlocker) return
    let prompts = 0
    const {
      builder,
      cleanup,
      navigateToNextRoute,
      nextUrl,
      previousUrl,
      reportUrl,
      runtime,
    } = createRemountingBuilderRuntime({
      installReportNavigationBlocker,
      confirmLeave: () => {
        prompts += 1
        return true
      },
    })

    navigateToNextRoute()
    runtime.history.back()
    await runtime.settle()

    builder.edit = 'Unsaved edit before confirmed Back'
    builder.dirty = true
    runtime.history.back()
    await runtime.settle()

    expect(runtime.location.href).toBe(previousUrl)
    expect(prompts).toBe(1)
    expect(builder.mounted).toBe(false)

    runtime.history.forward()
    await runtime.settle()

    const history = runtime.snapshot()
    expect(history.index).toBe(1)
    expect(history.entries.map(entry => entry.url)).toEqual([
      previousUrl,
      reportUrl,
      reportUrl,
      nextUrl,
    ])
    expect(history.entries.map(entry => reportNavigationPoint(entry.state))).toEqual([
      null,
      0,
      1,
      null,
    ])
    expect(builder).toEqual({
      dirty: true,
      edit: 'Unsaved edit before confirmed Back',
      mounted: true,
      mounts: 3,
      routeLeaves: 2,
    })
    expect(prompts).toBe(1)
    cleanup()
  })

  it('cancels dirty Forward to unowned C and restores B point 1 once', async () => {
    const installReportNavigationBlocker = await loadNavigationBlocker()
    if (!installReportNavigationBlocker) return
    let prompts = 0
    const {
      builder,
      cleanup,
      navigateToNextRoute,
      nextUrl,
      previousUrl,
      reportUrl,
      runtime,
    } = createRemountingBuilderRuntime({
      installReportNavigationBlocker,
      confirmLeave: () => {
        prompts += 1
        return false
      },
    })

    navigateToNextRoute()
    runtime.history.back()
    await runtime.settle()
    builder.edit = 'Unsaved Forward edit'
    builder.dirty = true

    runtime.history.forward()
    await runtime.settle()

    const history = runtime.snapshot()
    expect(prompts).toBe(1)
    expect(runtime.location.href).toBe(reportUrl)
    expect(history.index).toBe(2)
    expect(history.entries.map(entry => entry.url)).toEqual([
      previousUrl,
      reportUrl,
      reportUrl,
      nextUrl,
    ])
    expect(builder).toEqual({
      dirty: true,
      edit: 'Unsaved Forward edit',
      mounted: true,
      mounts: 2,
      routeLeaves: 1,
    })
    cleanup()
  })

  it('confirms dirty Forward to unowned C with one prompt and one departure', async () => {
    const installReportNavigationBlocker = await loadNavigationBlocker()
    if (!installReportNavigationBlocker) return
    let prompts = 0
    const {
      builder,
      cleanup,
      navigateToNextRoute,
      nextUrl,
      runtime,
    } = createRemountingBuilderRuntime({
      installReportNavigationBlocker,
      confirmLeave: () => {
        prompts += 1
        return true
      },
    })

    navigateToNextRoute()
    runtime.history.back()
    await runtime.settle()
    builder.edit = 'Confirmed Forward edit'
    builder.dirty = true

    runtime.history.forward()
    await runtime.settle()

    expect(prompts).toBe(1)
    expect(runtime.location.href).toBe(nextUrl)
    expect(runtime.snapshot().index).toBe(3)
    expect(builder).toEqual({
      dirty: true,
      edit: 'Confirmed Forward edit',
      mounted: false,
      mounts: 2,
      routeLeaves: 2,
    })
    cleanup()
  })
})
