import { describe, expect, it, vi } from 'vitest'
import { LayoutController } from '@deepseek-ai/dsh-client-ui-layout/src/client/service.ts'
import type { PanelActions } from '@deepseek-ai/dsh-client-ui-layout/src/client/service.ts'

function fakePanels(): PanelActions {
  return {
    setSidebar: vi.fn(),
    setDetails: vi.fn(),
    toggleSidebar: vi.fn(),
    setNarrow: vi.fn(),
    openDetails: vi.fn(),
    closeDetails: vi.fn(),
    openPrimaryPage: vi.fn(),
    closePrimaryPage: vi.fn(),
  }
}

describe('LayoutController', () => {
  it('forwards panel and primary-page actions to the attached set', () => {
    const service = new LayoutController()
    const panels = fakePanels()
    service.attachPanels(panels)

    service.toggleSidebar()
    service.openDetails()
    service.closeDetails()
    service.openPrimaryPage('knowledge-base')
    service.closePrimaryPage()

    expect(panels.toggleSidebar).toHaveBeenCalledTimes(1)
    expect(panels.openDetails).toHaveBeenCalledTimes(1)
    expect(panels.closeDetails).toHaveBeenCalledTimes(1)
    expect(panels.openPrimaryPage).toHaveBeenCalledWith('knowledge-base')
    expect(panels.closePrimaryPage).toHaveBeenCalledTimes(1)
    expect(panels.setSidebar).not.toHaveBeenCalled()
    expect(panels.setDetails).not.toHaveBeenCalled()
  })

  it('fails loud before the root entry wired its actions', () => {
    const service = new LayoutController()
    expect(() => { service.toggleSidebar() }).toThrow(/panel actions not wired/)
    expect(() => { service.openDetails() }).toThrow(/panel actions not wired/)
    expect(() => { service.closeDetails() }).toThrow(/panel actions not wired/)
    expect(() => { service.openPrimaryPage('knowledge-base') }).toThrow(/panel actions not wired/)
    expect(() => { service.closePrimaryPage() }).toThrow(/panel actions not wired/)
  })

  it('publishes stable primary-page snapshots and rejects empty keys', () => {
    const service = new LayoutController()
    service.attachPanels(fakePanels())
    const listener = vi.fn()
    const off = service.subscribePrimaryPage(listener)

    service.openPrimaryPage(' knowledge-base ')
    service.openPrimaryPage('knowledge-base')
    expect(service.getPrimaryPage()).toBe('knowledge-base')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(() => { service.openPrimaryPage('  ') }).toThrow(/must not be empty/)

    service.closePrimaryPage()
    service.closePrimaryPage()
    expect(service.getPrimaryPage()).toBeNull()
    expect(listener).toHaveBeenCalledTimes(2)
    off()
    service.openPrimaryPage('other')
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('re-attach overwrites the stale action set (entry re-register)', () => {
    const service = new LayoutController()
    const stale = fakePanels()
    const fresh = fakePanels()
    service.attachPanels(stale)
    service.attachPanels(fresh)

    service.toggleSidebar()

    expect(stale.toggleSidebar).not.toHaveBeenCalled()
    expect(fresh.toggleSidebar).toHaveBeenCalledTimes(1)
  })

  it('restores the selected primary page into a re-attached root store', () => {
    const service = new LayoutController()
    service.attachPanels(fakePanels())
    service.openPrimaryPage('knowledge-base')
    const fresh = fakePanels()
    service.attachPanels(fresh)
    expect(fresh.openPrimaryPage).toHaveBeenCalledWith('knowledge-base')
  })
})
