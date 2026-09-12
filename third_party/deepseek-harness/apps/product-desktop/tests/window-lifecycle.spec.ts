import { describe, expect, it, vi } from 'vitest'
import { createDesktopLifecycle } from '../src/window-lifecycle.js'

describe('desktop window lifecycle', () => {
  it('hides a normal close and leaves the host running', () => {
    const preventDefault = vi.fn()
    const hideWindow = vi.fn()
    const shutdownHost = vi.fn(async () => {})
    const lifecycle = createDesktopLifecycle({
      showWindow: vi.fn(),
      hideWindow,
      shutdownHost,
      quitApp: vi.fn(),
      reportShutdownError: vi.fn(),
    })
    lifecycle.handleWindowClose({ preventDefault })
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(hideWindow).toHaveBeenCalledOnce()
    expect(shutdownHost).not.toHaveBeenCalled()
  })

  it('coalesces explicit quits and stops the host before exiting', async () => {
    const order: string[] = []
    const lifecycle = createDesktopLifecycle({
      showWindow: vi.fn(),
      hideWindow: vi.fn(),
      shutdownHost: vi.fn(async () => { order.push('host') }),
      quitApp: vi.fn(() => { order.push('app') }),
      reportShutdownError: vi.fn(),
    })
    const first = lifecycle.requestQuit()
    const second = lifecycle.requestQuit()
    expect(first).toBe(second)
    await first
    expect(lifecycle.isQuitting()).toBe(true)
    expect(order).toEqual(['host', 'app'])
  })

  it('reports shutdown failure but still exits', async () => {
    const reportShutdownError = vi.fn()
    const quitApp = vi.fn()
    const lifecycle = createDesktopLifecycle({
      showWindow: vi.fn(),
      hideWindow: vi.fn(),
      shutdownHost: vi.fn(async () => { throw new Error('stop failed') }),
      quitApp,
      reportShutdownError,
    })
    await lifecycle.requestQuit()
    expect(reportShutdownError).toHaveBeenCalledOnce()
    expect(quitApp).toHaveBeenCalledOnce()
  })
})
