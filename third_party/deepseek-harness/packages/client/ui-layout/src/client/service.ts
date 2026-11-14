/**
 * LayoutController: the cross-plugin panel-action face behind ctx.layout.
 * Panel geometry itself lives in the root entry's layout store (stores.ts);
 * the current-session selection lives with the runtime sessions service, and
 * the per-session active view dissolved into ui-conversation's session store
 * (its only consumer). What remains here is the contract other plugins'
 * apply worlds reach for panel transitions (sidebar toggle from ui-sidebar,
 * details open/close from ui-conversation) — writes stay inside the store's
 * declared action set, delivered as the registration's bound actions.
 */
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
import type { createLayoutStore } from './stores.ts'

/** The layout store's bound action set (framework-baked, draft params peeled). */
export type PanelActions = BoundActions<ReturnType<typeof createLayoutStore>>

/**
 * The outward layout face (`ctx.layout`): the panel transitions other
 * plugins may trigger — and exactly what a test fake must supply. The
 * attachPanels wiring hook stays on the concrete class (root-entry assembly
 * only).
 */
export interface ILayout {
  /** Toggle the sidebar panel (closed ⟷ contract default width). */
  toggleSidebar(): void
  /** Open the details panel (no-op when already open). */
  openDetails(): void
  /** Close the details panel. */
  closeDetails(): void
  /**
   * Open a root-scoped product page in the shell's primary surface.
   * @param pageId - Stable id registered in the root `main.page` Slot.
   */
  openPrimaryPage(pageId: string): void
  /** Return from a product page to the ordinary conversation surface. */
  closePrimaryPage(): void
  /**
   * Read the selected primary page; null means the conversation surface.
   * @returns the selected page id or null.
   */
  getPrimaryPage(): string | null
  /**
   * Observe primary-page selection without exposing the layout store.
   * @param listener - Callback invoked after the selected page changes.
   * @returns a disposer that removes the listener.
   */
  subscribePrimaryPage(listener: () => void): () => void
}

/** Cross-plugin panel-action face (ctx.layout). */
export class LayoutController implements ILayout {
  #panels: PanelActions | undefined
  #primaryPage: string | null = null
  #listeners = new Set<() => void>()

  /**
   * Adopt the root entry's bound store actions. Called from the root
   * registration's inject hook (a sanctioned assembly side effect), so the
   * face is live from the entry's first render; on entry re-register the
   * fresh actions overwrite the stale set.
   * @param actions - bound actions of the entry's layout store instance.
   */
  attachPanels(actions: PanelActions): void {
    this.#panels = actions
    // The service outlives a root-entry remount. Re-apply its navigation
    // snapshot so a fresh transient layout store does not silently return to
    // the conversation while consumers still observe an open primary page.
    if (this.#primaryPage !== null) actions.openPrimaryPage(this.#primaryPage)
  }

  /** Toggle the sidebar panel (closed ⟷ contract default width). */
  toggleSidebar(): void {
    this.#require().toggleSidebar()
  }

  /** Open the details panel (no-op when already open). */
  openDetails(): void {
    this.#require().openDetails()
  }

  /** Close the details panel. */
  closeDetails(): void {
    this.#require().closeDetails()
  }

  /**
   * Open a keyed primary page and publish the selection to apply-world consumers.
   * @param pageId - Stable id registered in the root `main.page` Slot.
   */
  openPrimaryPage(pageId: string): void {
    const normalized = pageId.trim()
    if (normalized.length === 0) throw new Error('layout: primary page id must not be empty')
    this.#require().openPrimaryPage(normalized)
    if (this.#primaryPage === normalized) return
    this.#primaryPage = normalized
    this.#notify()
  }

  /** Close the selected primary page and return to the conversation surface. */
  closePrimaryPage(): void {
    this.#require().closePrimaryPage()
    if (this.#primaryPage === null) return
    this.#primaryPage = null
    this.#notify()
  }

  /**
   * Read the current primary-page selection.
   * @returns the selected page id, or null for the conversation surface.
   */
  getPrimaryPage(): string | null { return this.#primaryPage }

  /**
   * Observe changes to the primary-page selection.
   * @param listener - Callback invoked after the selected page changes.
   * @returns a disposer that removes the listener.
   */
  subscribePrimaryPage(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  #notify(): void {
    for (const listener of this.#listeners) listener()
  }

  #require(): PanelActions {
    // Callers are UI gestures, which cannot fire before the root entry
    // rendered (the inject hook runs in its first render) — reaching this
    // unwired is a boot-order bug, not a race to tolerate.
    if (this.#panels === undefined) throw new Error('layout: panel actions not wired (root entry not mounted)')
    return this.#panels
  }
}
