/** Native attach-target picker: only provider-declared targets, never a generic process API. */

import type { MessageBoxOptions } from 'electron'

/** One provider-declared attach target; name plus one of process id, port, or URL. */
export interface DesktopAttachTarget {
  readonly name: string
  readonly processId?: number
  readonly port?: number
  readonly host?: string
  readonly url?: string
}

/**
 * Execution-world facts the provider probe receives. Structural mirror of the
 * debug seam's environment face so the shell holds no debug-package
 * dependency; the host bridge supplies the real value.
 */
export interface DesktopAttachEnvironment {
  readonly workspaceRoot: string
  readonly cwd: string
  readonly platform: NodeJS.Platform
  readonly arch: string
  readonly pathSeparator: '/' | '\\'
}

/** The provider face the picker consumes. */
export interface DesktopAttachProvider {
  /**
   * Probe the execution world for attachable targets.
   * @param environment - the execution world to probe.
   * @param signal - cancellation for a user-cancelled picker.
   * @returns the provider-declared targets in provider order.
   */
  probeAttachTargets?(environment: DesktopAttachEnvironment, signal?: AbortSignal): Promise<readonly DesktopAttachTarget[]>
}

/**
 * List the targets one provider declares discoverable in the execution world.
 * A provider without a probe declares nothing, so the picker offers no
 * targets; the Electron shell never enumerates host processes itself.
 * @param provider - the provider whose probe runs.
 * @param environment - the execution world to probe.
 * @param signal - cancellation for a user-cancelled picker.
 * @returns the provider-declared targets in provider order.
 */
export async function listAttachTargets(
  provider: DesktopAttachProvider,
  environment: DesktopAttachEnvironment,
  signal?: AbortSignal,
): Promise<readonly DesktopAttachTarget[]> {
  return provider.probeAttachTargets === undefined ? [] : provider.probeAttachTargets(environment, signal)
}

/** Localized picker-dialog copy. */
export interface DesktopAttachPickerLabels {
  readonly title: string
  readonly message: string
  readonly cancel: string
}

/**
 * Render the provider-declared targets as a native selection dialog.
 * @param labels - localized title, message, and cancel copy.
 * @param targets - the targets to offer, in provider order.
 * @returns dialog options whose buttons are the target names plus cancel.
 */
export function attachTargetDialog(labels: DesktopAttachPickerLabels, targets: readonly DesktopAttachTarget[]): MessageBoxOptions {
  return {
    type: 'info',
    title: labels.title,
    message: labels.message,
    buttons: [...targets.map(target => target.name), labels.cancel],
    cancelId: targets.length,
    defaultId: 0,
    noLink: true,
  }
}
