/**
 * The workbench panel registry (`ctx.workbenchPanels`): the typed seat where
 * `ui-code-editor`, `ui-debug`, and future tools contribute panels to the
 * debug workbench.
 *
 * A contribution names its dock location and its draw order, and carries its
 * own component; the registry holds the contributions and nothing else — no
 * React tree, no business state, no layout. Duplicate ids fail the
 * registration instead of overwriting, so two packages claiming one panel id
 * stop at load rather than silently replacing each other. Registration is an
 * effect: the returned disposer removes the panel, and a disposal that lost a
 * race with a same-id registration leaves the later registration in place.
 *
 * Failure uses the debug seam's error type and codes, because the workbench is
 * the debug capability's client surface and callers route on the same codes.
 * @module @deepseek-ai/dsh-client-ui-workbench/workbench-panels
 */
import type { ComponentType } from 'react'
import { DebugError } from '@deepseek-ai/dsh-debug'

/** Where the workbench docks a panel. */
export type WorkbenchPanelLocation = 'left' | 'center' | 'right' | 'bottom'

/** One panel contribution as the registry receives it. */
export interface WorkbenchPanelContribution {
  /** Stable panel id; the layout persists ids, never components. */
  readonly id: string
  /** Localized title factory, re-read on render so language switches apply. */
  readonly title: () => string
  /** Icon reference the shell resolves. */
  readonly icon: string
  /** The panel's component; it draws from its own injected state. */
  readonly component: ComponentType
  /** Where the panel docks when the layout has no stored choice for it. */
  readonly defaultLocation: WorkbenchPanelLocation
  /** Draw order within a location; earlier first, and `0` when omitted. */
  readonly order?: number
}

/**
 * Separate the explicit-order bands from registration order so a later
 * registration with a smaller `order` still lists first.
 */
const SEQUENCE_STRIDE = 1_000_000

/** Draw order of one listed contribution: explicit `order` first, then registration order. */
function listOrder(entry: { readonly contribution: WorkbenchPanelContribution; readonly sequence: number }): number {
  return (entry.contribution.order ?? 0) * SEQUENCE_STRIDE + entry.sequence
}

/** Registry over panel contributions, with conflict-checked registration. */
export class WorkbenchPanelRegistry {
  /** Registered panels in registration order; `Map` keeps that order stable. */
  private readonly panels = new Map<string, { readonly contribution: WorkbenchPanelContribution; readonly sequence: number }>()
  /** Monotonic registration counter feeding {@link listOrder}. */
  private sequence = 0

  /**
   * Register one panel contribution.
   * @param contribution - the panel to add.
   * @returns the disposer removing the panel; calling it after a replacement
   *   registration of the same id leaves the replacement in place.
   * @throws {@link DebugError} `DEBUG_CONFLICT` when the id is already registered.
   */
  register(contribution: WorkbenchPanelContribution): () => void {
    if (this.panels.has(contribution.id)) {
      throw new DebugError(`a workbench panel with id "${contribution.id}" is already registered`, 'DEBUG_CONFLICT', {
        detail: contribution.id,
      })
    }
    const sequence = this.sequence
    this.sequence += 1
    this.panels.set(contribution.id, { contribution, sequence })
    return () => {
      const current = this.panels.get(contribution.id)
      if (current !== undefined && current.sequence === sequence) this.panels.delete(contribution.id)
    }
  }

  /**
   * Snapshot the registered panels in draw order: explicit `order` ascending,
   * then registration order within the same `order`.
   * @returns the contributions, ordered; a fresh array over the registry's own entries.
   */
  list(): readonly WorkbenchPanelContribution[] {
    return [...this.panels.values()]
      .sort((left, right) => listOrder(left) - listOrder(right))
      .map(entry => entry.contribution)
  }
}
