/** Minimal app/window/host surfaces used by the desktop lifecycle coordinator. */
export interface DesktopLifecycleOptions {
  showWindow(): void
  hideWindow(): void
  shutdownHost(): Promise<void>
  quitApp(): void
  reportShutdownError(error: unknown): void
}

/** Close-to-tray and explicit-quit controls for one desktop instance. */
export interface DesktopLifecycle {
  isQuitting(): boolean
  handleWindowClose(event: { preventDefault(): void }): void
  showWindow(): void
  requestQuit(): Promise<void>
}

/** Coordinate window hiding and a single bounded host shutdown before app exit. */
export function createDesktopLifecycle(options: DesktopLifecycleOptions): DesktopLifecycle {
  let quitting = false
  let quitPromise: Promise<void> | undefined

  const requestQuit = (): Promise<void> => {
    if (quitPromise) return quitPromise
    quitting = true
    quitPromise = options.shutdownHost()
      .catch((error: unknown) => { options.reportShutdownError(error) })
      .then(() => { options.quitApp() })
    return quitPromise
  }

  return {
    isQuitting: () => quitting,
    handleWindowClose: (event) => {
      if (quitting) return
      event.preventDefault()
      options.hideWindow()
    },
    showWindow: () => { options.showWindow() },
    requestQuit,
  }
}
