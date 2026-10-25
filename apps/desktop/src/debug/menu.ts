/** The Debug application menu: the workbench toolbar's five commands with native accelerators. */

import type { MenuItemConstructorOptions } from 'electron'
import type { ShortcutCommandId } from '@deepseek-ai/dsh-client-shortcuts/protocol'

/** The debug commands the workbench registers; the menu forwards exactly these. */
export const DEBUG_MENU_COMMANDS = {
  start: 'debug.start',
  continue: 'debug.continue',
  step: 'debug.step',
  stop: 'debug.stop',
  toggleBreakpoint: 'debug.toggleBreakpoint',
} as const

/** One debug menu command id. */
export type DebugMenuCommandId = (typeof DEBUG_MENU_COMMANDS)[keyof typeof DEBUG_MENU_COMMANDS]

/** Localized copy for the Debug menu, from the shell dictionary. */
export interface DesktopDebugMenuLabels {
  readonly menu: string
  readonly start: string
  readonly continue: string
  readonly step: string
  readonly stop: string
  readonly toggleBreakpoint: string
}

/** Menu build inputs: localized copy, command delivery, and current deliverability. */
export interface DesktopDebugMenuOptions {
  readonly labels: DesktopDebugMenuLabels
  /**
   * Forward one command id to the product window's command registry — the
   * same registry the toolbar and keyboard shortcuts dispatch through, so
   * approval and caller identity apply identically to menu clicks.
   * @param commandId - one of {@link DEBUG_MENU_COMMANDS}.
   */
  dispatch(commandId: DebugMenuCommandId): void
  /** @returns whether the product window can accept commands right now. */
  enabled(): boolean
}

/**
 * Build the Debug application menu.
 * @param options - labels, dispatch, and deliverability.
 * @returns the top-level menu entry for the application menu template.
 */
export function debugMenu(options: DesktopDebugMenuOptions): MenuItemConstructorOptions {
  const items: readonly (readonly [DebugMenuCommandId, string, string])[] = [
    [DEBUG_MENU_COMMANDS.start, options.labels.start, 'CmdOrCtrl+Shift+F5'],
    [DEBUG_MENU_COMMANDS.continue, options.labels.continue, 'F5'],
    [DEBUG_MENU_COMMANDS.step, options.labels.step, 'F10'],
    [DEBUG_MENU_COMMANDS.stop, options.labels.stop, 'Shift+F5'],
    [DEBUG_MENU_COMMANDS.toggleBreakpoint, options.labels.toggleBreakpoint, 'F9'],
  ]
  const enabled = options.enabled()
  return {
    label: options.labels.menu,
    submenu: items.map(([commandId, label, accelerator]) => ({
      label,
      enabled,
      accelerator,
      click: (): void => { options.dispatch(commandId) },
    })),
  }
}

/**
 * Build the menu-originated input for the product window's command channel.
 * @param commandId - one debug command id, forwarded verbatim to the registry.
 * @returns the command id cast to the shortcuts input's branded id type.
 */
export function debugMenuCommand(commandId: DebugMenuCommandId): ShortcutCommandId {
  return commandId as ShortcutCommandId
}
