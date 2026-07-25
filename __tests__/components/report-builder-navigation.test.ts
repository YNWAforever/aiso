import { describe, expect, it } from 'vitest'

type PopStateListener = (event: RuntimePopStateEvent) => void
type NavigationBlockerInstaller = (options: {
  browser: RuntimeBrowser
  confirmLeave: () => boolean
  prepareFailOpen?: () => () => void
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
  private readonly beforeUnloadListeners: EventListener[] = []
  private readonly fullNavigationListeners: Array<() => void> = []
  private pendingTraversals = 0
  private timerSequence = 0
  private abandonNextNavigation = false
  private nextNavigationError: Error | null = null
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>()

  fullNavigations = 0
  fullNavigationThrows = 0
  nativeUnloadPrompts = 0
  readonly timerErrors: unknown[] = []

  readonly location = {
    href: '',
    assign: (url: string | URL) => {
      const destination = new URL(url, this.location.href).href
      const beforeUnload = new Event('beforeunload', { cancelable: true })
      for (const listener of this.beforeUnloadListeners) listener(beforeUnload)
      if (beforeUnload.defaultPrevented) {
        this.nativeUnloadPrompts += 1
        return
      }
      if (this.nextNavigationError) {
        const error = this.nextNavigationError
        this.nextNavigationError = null
        this.fullNavigationThrows += 1
        throw error
      }
      if (this.abandonNextNavigation) {
        this.abandonNextNavigation = false
        return
      }
      this.location.href = destination
      this.fullNavigations += 1
      for (const listener of this.fullNavigationListeners) listener()
    },
  }

  readonly navigation?: { currentEntry: { index: number } }

  readonly setTimeout = (handler: () => void, timeout?: number) => {
    void timeout
    const id = ++this.timerSequence
    const timer = setTimeout(() => {
      this.timers.delete(id)
      try {
        handler()
      } catch (error) {
        this.timerErrors.push(error)
      }
    }, 0)
    this.timers.set(id, timer)
    return id
  }

  readonly clearTimeout = (id: number) => {
    const timer = this.timers.get(id)
    if (!timer) return
    clearTimeout(timer)
    this.timers.delete(id)
  }

  readonly history = {
    state: null as unknown,
    length: 0,
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
      this.history.length = this.entries.length
      this.syncNavigationIndex()
      this.history.state = state
      this.location.href = currentUrl
    },
    go: (delta: number) => {
      const targetIndex = this.index + delta
      if (targetIndex < 0 || targetIndex >= this.entries.length) return
      this.pendingTraversals += 1
      queueMicrotask(() => {
        this.index = targetIndex
        this.syncNavigationIndex()
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

  constructor(
    entries: Array<{ state: unknown; url: string }>,
    index: number,
    supportsNavigation = true,
  ) {
    this.entries = entries.map(entry => ({ ...entry }))
    this.index = index
    if (supportsNavigation) {
      this.navigation = { currentEntry: { index } }
    }
    this.history.length = this.entries.length
    this.history.state = this.entries[index].state
    this.location.href = this.entries[index].url
  }

  addFullNavigationListener(listener: () => void) {
    this.fullNavigationListeners.push(listener)
  }

  abandonNextFullNavigation() {
    this.abandonNextNavigation = true
  }

  throwOnNextFullNavigation(error: Error) {
    this.nextNavigationError = error
  }

  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ) {
    if (typeof listener !== 'function') return
    if (type === 'beforeunload') {
      this.beforeUnloadListeners.push(listener)
      return
    }
    if (type !== 'popstate') return
    const capture = typeof options === 'boolean' ? options : options?.capture === true
    ;(capture ? this.captureListeners : this.bubbleListeners).push(listener as PopStateListener)
  }

  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ) {
    if (typeof listener !== 'function') return
    if (type === 'beforeunload') {
      const index = this.beforeUnloadListeners.indexOf(listener)
      if (index !== -1) this.beforeUnloadListeners.splice(index, 1)
      return
    }
    if (type !== 'popstate') return
    const capture = typeof options === 'boolean' ? options : options?.capture === true
    const listeners = capture ? this.captureListeners : this.bubbleListeners
    const index = listeners.indexOf(listener as PopStateListener)
    if (index !== -1) listeners.splice(index, 1)
  }

  async settle() {
    do {
      await new Promise<void>(resolve => setImmediate(resolve))
    } while (this.pendingTraversals > 0 || this.timers.size > 0)
  }

  snapshot() {
    return {
      entries: this.entries.map(entry => ({ ...entry })),
      index: this.index,
    }
  }

  replaceEntryState(index: number, state: unknown) {
    this.entries[index] = { ...this.entries[index], state }
    if (index === this.index) this.history.state = state
  }

  private syncNavigationIndex() {
    if (this.navigation) this.navigation.currentEntry.index = this.index
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
  ], 1, false)
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
  supportsNavigation = true,
}: {
  confirmLeave: () => boolean
  installReportNavigationBlocker: NavigationBlockerInstaller
  supportsNavigation?: boolean
}) {
  const previousUrl = 'https://app.example/en/dashboard/client-1/reports'
  const reportUrl = 'https://app.example/en/dashboard/client-1/reports/new'
  const nextUrl = 'https://app.example/en/dashboard/client-1/overview'
  const runtime = new RuntimeBrowser([
    { state: { __NA: true, route: 'A' }, url: previousUrl },
    { state: { __NA: true, route: 'B' }, url: reportUrl },
  ], 1, supportsNavigation)
  const builder = {
    dirty: false,
    edit: 'Saved executive summary',
    mounted: false,
    mounts: 0,
    routeLeaves: 0,
  }
  const nextPopstateUrls: string[] = []
  let removeNavigationBlocker: (() => void) | null = null
  let allowUnload = false
  let rearmUnloadGuardTimeout: number | null = null

  const warnBeforeUnload = (event: Event) => {
    if (!builder.dirty || allowUnload) return
    event.preventDefault()
  }
  const restoreUnloadGuard = () => {
    if (rearmUnloadGuardTimeout !== null) {
      runtime.clearTimeout(rearmUnloadGuardTimeout)
      rearmUnloadGuardTimeout = null
    }
    allowUnload = false
  }
  const prepareFailOpen = () => {
    allowUnload = true
    rearmUnloadGuardTimeout = runtime.setTimeout(restoreUnloadGuard, 1_000)
    return restoreUnloadGuard
  }

  const mount = () => {
    if (builder.mounted) return
    builder.mounted = true
    builder.mounts += 1
    runtime.addEventListener('beforeunload', warnBeforeUnload)
    removeNavigationBlocker = installReportNavigationBlocker({
      browser: runtime,
      confirmLeave,
      prepareFailOpen,
      shouldBlock: () => builder.dirty,
    })
  }
  const unmount = () => {
    if (!builder.mounted) return
    removeNavigationBlocker?.()
    removeNavigationBlocker = null
    runtime.removeEventListener('beforeunload', warnBeforeUnload)
    restoreUnloadGuard()
    builder.mounted = false
    builder.routeLeaves += 1
  }

  // Next's popstate listener is registered before the component effect.
  runtime.addEventListener('popstate', () => {
    nextPopstateUrls.push(runtime.location.href)
    if (runtime.location.href === reportUrl) {
      mount()
      return
    }
    unmount()
  })
  runtime.addFullNavigationListener(unmount)
  mount()

  return {
    builder,
    cleanup: () => removeNavigationBlocker?.(),
    navigateToNextRoute: () => {
      runtime.history.pushState({ __NA: true, route: 'C' }, '', nextUrl)
      unmount()
    },
    nextUrl,
    nextPopstateUrls,
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
      supportsNavigation: false,
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

  it('cancels a direct B1-to-A jump and restores the exact report entry', async () => {
    const installReportNavigationBlocker = await loadNavigationBlocker()
    if (!installReportNavigationBlocker) return
    let prompts = 0
    const {
      builder,
      cleanup,
      navigateToNextRoute,
      nextPopstateUrls,
      previousUrl,
      reportUrl,
      runtime,
    } = createRemountingBuilderRuntime({
      installReportNavigationBlocker,
      confirmLeave: () => {
        prompts += 1
        return false
      },
      supportsNavigation: false,
    })

    navigateToNextRoute()
    runtime.history.back()
    await runtime.settle()
    nextPopstateUrls.length = 0
    builder.edit = 'Unsaved B1 edit before direct A jump'
    builder.dirty = true

    runtime.history.go(-2)
    await runtime.settle()

    const history = runtime.snapshot()
    expect(prompts).toBe(1)
    expect(nextPopstateUrls).toEqual([])
    expect(runtime.location.href).toBe(reportUrl)
    expect(history.index).toBe(2)
    expect(history.entries.map(entry => entry.url)).toEqual([
      previousUrl,
      reportUrl,
      reportUrl,
      'https://app.example/en/dashboard/client-1/overview',
    ])
    expect(history.entries.map(entry => reportNavigationPoint(entry.state))).toEqual([
      null,
      0,
      1,
      null,
    ])
    expect(builder).toEqual({
      dirty: true,
      edit: 'Unsaved B1 edit before direct A jump',
      mounted: true,
      mounts: 2,
      routeLeaves: 1,
    })
    cleanup()
  })

  it('confirms a direct B1-to-A jump and exposes A to Next exactly once', async () => {
    const installReportNavigationBlocker = await loadNavigationBlocker()
    if (!installReportNavigationBlocker) return
    let prompts = 0
    const {
      builder,
      cleanup,
      navigateToNextRoute,
      nextPopstateUrls,
      previousUrl,
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
    nextPopstateUrls.length = 0
    builder.edit = 'Confirmed direct A jump'
    builder.dirty = true

    runtime.history.go(-2)
    await runtime.settle()

    expect(prompts).toBe(1)
    expect(nextPopstateUrls).toEqual([previousUrl])
    expect(runtime.location.href).toBe(previousUrl)
    expect(runtime.snapshot().index).toBe(0)
    expect(builder).toEqual({
      dirty: true,
      edit: 'Confirmed direct A jump',
      mounted: false,
      mounts: 2,
      routeLeaves: 2,
    })
    cleanup()
  })

  it('cancels a direct B0-to-C jump and restores the exact report entry', async () => {
    const installReportNavigationBlocker = await loadNavigationBlocker()
    if (!installReportNavigationBlocker) return
    let prompts = 0
    const {
      builder,
      cleanup,
      navigateToNextRoute,
      nextPopstateUrls,
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
      supportsNavigation: false,
    })

    navigateToNextRoute()
    runtime.history.go(-2)
    await runtime.settle()
    nextPopstateUrls.length = 0
    builder.edit = 'Unsaved B0 edit before direct C jump'
    builder.dirty = true

    runtime.history.go(2)
    await runtime.settle()

    const history = runtime.snapshot()
    expect(prompts).toBe(1)
    expect(nextPopstateUrls).toEqual([])
    expect(runtime.location.href).toBe(reportUrl)
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
      edit: 'Unsaved B0 edit before direct C jump',
      mounted: true,
      mounts: 2,
      routeLeaves: 1,
    })
    cleanup()
  })

  it('confirms a direct B0-to-C jump and exposes C to Next exactly once', async () => {
    const installReportNavigationBlocker = await loadNavigationBlocker()
    if (!installReportNavigationBlocker) return
    let prompts = 0
    const {
      builder,
      cleanup,
      navigateToNextRoute,
      nextPopstateUrls,
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
    runtime.history.go(-2)
    await runtime.settle()
    nextPopstateUrls.length = 0
    builder.edit = 'Confirmed direct C jump'
    builder.dirty = true

    runtime.history.go(2)
    await runtime.settle()

    expect(prompts).toBe(1)
    expect(nextPopstateUrls).toEqual([nextUrl])
    expect(runtime.location.href).toBe(nextUrl)
    expect(runtime.snapshot().index).toBe(3)
    expect(builder).toEqual({
      dirty: true,
      edit: 'Confirmed direct C jump',
      mounted: false,
      mounts: 2,
      routeLeaves: 2,
    })
    cleanup()
  })

  it('restores B0 across four entries without exposing intermediate routes', async () => {
    const installReportNavigationBlocker = await loadNavigationBlocker()
    if (!installReportNavigationBlocker) return
    let prompts = 0
    const {
      builder,
      cleanup,
      navigateToNextRoute,
      nextPopstateUrls,
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
      supportsNavigation: false,
    })
    const detailUrl = 'https://app.example/en/dashboard/client-1/detail'
    const settingsUrl = 'https://app.example/en/dashboard/client-1/settings'

    navigateToNextRoute()
    runtime.history.pushState({ __NA: true, route: 'D' }, '', detailUrl)
    runtime.history.pushState({ __NA: true, route: 'E' }, '', settingsUrl)
    runtime.history.go(-4)
    await runtime.settle()
    nextPopstateUrls.length = 0
    builder.edit = 'Unsaved long-jump edit'
    builder.dirty = true

    runtime.history.go(4)
    await runtime.settle()

    const history = runtime.snapshot()
    expect(prompts).toBe(1)
    expect(nextPopstateUrls).toEqual([])
    expect(runtime.location.href).toBe(reportUrl)
    expect(history.index).toBe(1)
    expect(history.entries.map(entry => entry.url)).toEqual([
      previousUrl,
      reportUrl,
      reportUrl,
      nextUrl,
      detailUrl,
      settingsUrl,
    ])
    expect(history.entries.map(entry => reportNavigationPoint(entry.state))).toEqual([
      null,
      0,
      1,
      null,
      null,
      null,
    ])
    expect(builder).toEqual({
      dirty: true,
      edit: 'Unsaved long-jump edit',
      mounted: true,
      mounts: 2,
      routeLeaves: 1,
    })
    cleanup()
  })

  it('fails open with a full navigation when the owned restoration point disappears', async () => {
    const installReportNavigationBlocker = await loadNavigationBlocker()
    if (!installReportNavigationBlocker) return
    let prompts = 0
    const {
      builder,
      cleanup,
      navigateToNextRoute,
      nextPopstateUrls,
      nextUrl,
      runtime,
    } = createRemountingBuilderRuntime({
      installReportNavigationBlocker,
      confirmLeave: () => {
        prompts += 1
        return false
      },
      supportsNavigation: true,
    })

    navigateToNextRoute()
    runtime.history.back()
    await runtime.settle()
    runtime.replaceEntryState(2, { __NA: true, route: 'BROKEN-B1' })
    nextPopstateUrls.length = 0
    builder.edit = 'Unsaved edit with broken history invariant'
    builder.dirty = true

    runtime.history.go(-2)
    await runtime.settle()

    expect(prompts).toBe(1)
    expect(runtime.nativeUnloadPrompts).toBe(0)
    expect(runtime.fullNavigations).toBe(1)
    expect(nextPopstateUrls).toEqual([])
    expect(runtime.location.href).toBe(nextUrl)
    expect(builder).toEqual({
      dirty: true,
      edit: 'Unsaved edit with broken history invariant',
      mounted: false,
      mounts: 2,
      routeLeaves: 2,
    })
    cleanup()
  })

  it('restores dirty unload protection when fail-open full navigation throws', async () => {
    const installReportNavigationBlocker = await loadNavigationBlocker()
    if (!installReportNavigationBlocker) return
    let prompts = 0
    const {
      builder,
      cleanup,
      navigateToNextRoute,
      runtime,
    } = createRemountingBuilderRuntime({
      installReportNavigationBlocker,
      confirmLeave: () => {
        prompts += 1
        return false
      },
      supportsNavigation: true,
    })

    navigateToNextRoute()
    runtime.history.back()
    await runtime.settle()
    runtime.replaceEntryState(2, { __NA: true, route: 'BROKEN-B1' })
    builder.edit = 'Unsaved edit before assign throws'
    builder.dirty = true
    const assignError = new Error('assign failed')
    runtime.throwOnNextFullNavigation(assignError)

    runtime.history.go(-2)
    await runtime.settle()

    expect(prompts).toBe(1)
    expect(runtime.fullNavigationThrows).toBe(1)
    expect(runtime.nativeUnloadPrompts).toBe(0)
    expect(runtime.fullNavigations).toBe(0)
    expect(builder.mounted).toBe(true)
    expect(runtime.timerErrors).toEqual([assignError])

    runtime.location.assign(runtime.location.href)

    expect(runtime.nativeUnloadPrompts).toBe(1)
    expect(runtime.fullNavigations).toBe(0)
    expect(builder.mounted).toBe(true)
    cleanup()
  })

  it('re-arms dirty unload protection when fail-open navigation does not complete', async () => {
    const installReportNavigationBlocker = await loadNavigationBlocker()
    if (!installReportNavigationBlocker) return
    let prompts = 0
    const {
      builder,
      cleanup,
      navigateToNextRoute,
      runtime,
    } = createRemountingBuilderRuntime({
      installReportNavigationBlocker,
      confirmLeave: () => {
        prompts += 1
        return false
      },
      supportsNavigation: true,
    })

    navigateToNextRoute()
    runtime.history.back()
    await runtime.settle()
    runtime.replaceEntryState(2, { __NA: true, route: 'BROKEN-B1' })
    builder.edit = 'Unsaved edit before navigation stalls'
    builder.dirty = true
    runtime.abandonNextFullNavigation()

    runtime.history.go(-2)
    await runtime.settle()

    expect(prompts).toBe(1)
    expect(runtime.nativeUnloadPrompts).toBe(0)
    expect(runtime.fullNavigations).toBe(0)
    expect(builder.mounted).toBe(true)

    runtime.location.assign(runtime.location.href)

    expect(runtime.nativeUnloadPrompts).toBe(1)
    expect(runtime.fullNavigations).toBe(0)
    expect(builder.mounted).toBe(true)
    cleanup()
  })
})
