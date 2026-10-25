/**
 * The workbench's persisted layout: which panels are open and where they
 * dock. The layout stores panel ids and dock locations only — never React
 * components, never business state — so it survives a client round trip
 * through plain JSON and stays writable per client without touching the
 * Session log.
 *
 * A panel the layout names but the registry does not list is ignored by the
 * renderer rather than an error: a disposed contribution must not wedge the
 * page that restored a layout naming it.
 * @module @deepseek-ai/dsh-client-ui-workbench/layout
 */
import type { WorkbenchPanelLocation } from './workbench-panels.ts'

/** One open panel's persisted placement. */
export interface WorkbenchLayoutPanel {
  /** The panel contribution's stable id. */
  readonly id: string
  /** Where the panel is docked. */
  readonly location: WorkbenchPanelLocation
}

/** The whole persisted layout. Every field is JSON-round-trippable plain data. */
export interface WorkbenchLayout {
  /** Open panels in stored order; the renderer reorders by contribution `order`. */
  readonly panels: readonly WorkbenchLayoutPanel[]
}

/**
 * Create the empty layout: no panels open.
 * @returns the initial layout.
 */
export function createWorkbenchLayout(): WorkbenchLayout {
  return { panels: [] }
}

/**
 * Open one panel, or move an already-open panel to a new location. The
 * returned layout is a new value; the input is never mutated.
 * @param layout - the layout to open into.
 * @param id - the panel contribution's id.
 * @param location - the dock location; the panel's stored location moves to it.
 * @returns the layout with the panel open at `location`.
 */
export function openWorkbenchPanel(
  layout: WorkbenchLayout,
  id: string,
  location: WorkbenchPanelLocation,
): WorkbenchLayout {
  const known = layout.panels.find(panel => panel.id === id)
  const entry: WorkbenchLayoutPanel = { id, location }
  if (known === undefined) return { panels: [...layout.panels, entry] }
  if (known.location === location) return layout
  return { panels: layout.panels.map(panel => (panel.id === id ? entry : panel)) }
}

/**
 * Find one panel's placement.
 * @param layout - the layout to search.
 * @param id - the panel contribution's id.
 * @returns the stored placement, or `undefined` while the panel is closed.
 */
export function findPanel(layout: WorkbenchLayout, id: string): WorkbenchLayoutPanel | undefined {
  return layout.panels.find(panel => panel.id === id)
}

/**
 * Close one panel.
 * @param layout - the layout to close in.
 * @param id - the panel contribution's id.
 * @returns the layout without the panel; unchanged when it was already closed.
 */
export function closeWorkbenchPanel(layout: WorkbenchLayout, id: string): WorkbenchLayout {
  if (!layout.panels.some(panel => panel.id === id)) return layout
  return { panels: layout.panels.filter(panel => panel.id !== id) }
}

/**
 * The open panel ids docked at one location, in stored order.
 * @param layout - the layout to read.
 * @param location - the dock location to list.
 * @returns the ids, in stored order.
 */
export function panelsAt(layout: WorkbenchLayout, location: WorkbenchPanelLocation): readonly string[] {
  return layout.panels.filter(panel => panel.location === location).map(panel => panel.id)
}
