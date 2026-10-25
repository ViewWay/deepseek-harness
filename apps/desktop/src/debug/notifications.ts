/** OS stop notifications for debug sessions: reason title plus workspace-relative location only. */

/**
 * One committed stop fact, structurally mirroring the debug seam's stop
 * snapshot so the Electron shell holds no debug-package dependency.
 */
export interface DesktopDebugStopSnapshot {
  readonly sessionId: string
  readonly reason: DesktopDebugStopReason
  readonly source: { readonly workspaceRelativePath: string; readonly absolutePath: string }
  readonly line: number
  readonly description?: string
}

/** Why the debugger stopped; the closed reason set of the debug seam. */
export type DesktopDebugStopReason =
  | 'breakpoint' | 'step' | 'pause' | 'entry' | 'exception'
  | 'dataBreakpoint' | 'instructionBreakpoint' | 'restart' | 'unknown'

/** The native notification face: one OS notification with the rendered copy and its click routing. */
export interface DesktopDebugNotifier {
  /**
   * Show one OS notification.
   * @param options - the rendered title and body; the only content ever surfaced.
   * @param onClick - click handler the adapter must attach to the notification;
   *   the wiring binds it to focusing the workbench and the stopped session.
   */
  show(options: { readonly title: string; readonly body: string }, onClick: () => void): void
}

/** One live debug event as notifications observe it: kind plus owning session. */
export interface DesktopDebugLiveEvent {
  readonly kind: string
  readonly sessionId?: string
}

/** Process-local subscription face over live debug events. */
export interface DesktopDebugEventSource {
  /**
   * Subscribe to live debug events.
   * @param filter - narrowing filter; an empty filter receives every event.
   * @param listener - synchronous listener for matching events.
   * @returns the disposer; after it runs, no further event reaches the listener.
   */
  subscribe(filter: object, listener: (event: DesktopDebugLiveEvent) => void): () => void
}

/**
 * Show one stop notification. The title names the stop reason and the body
 * names the workspace-relative source location; nothing else in the snapshot
 * reaches the notification — no description, absolute path, column, or any
 * variable, environment, or memory value. Clicking the notification runs
 * `onClick`, which the wiring binds to focusing the workbench and session.
 * @param notifier - the native notification sink.
 * @param snapshot - the committed stop fact.
 * @param titles - localized title per stop reason, from the shell dictionary.
 * @param onClick - click handler bound to focusing the workbench and session.
 */
export function notifyDebugStop(
  notifier: DesktopDebugNotifier,
  snapshot: DesktopDebugStopSnapshot,
  titles: Readonly<Record<DesktopDebugStopReason, string>>,
  onClick: () => void,
): void {
  notifier.show({ title: titles[snapshot.reason], body: `${snapshot.source.workspaceRelativePath}:${snapshot.line}` }, onClick)
}

/** Install inputs: live events, the committed stop lookup, the notification sink, and click focus. */
export interface DesktopDebugNotificationOptions {
  readonly events: DesktopDebugEventSource
  /**
   * Resolve the committed stop fact for one session.
   * @param sessionId - the stopped session's id.
   * @returns the stop fact, or null when no stop remains reportable.
   */
  stopSnapshot(sessionId: string): Promise<DesktopDebugStopSnapshot | null>
  readonly notify: DesktopDebugNotifier
  readonly titles: Readonly<Record<DesktopDebugStopReason, string>>
  /** Click handler for every stop notification, bound to focusing the workbench and stopped session. */
  readonly focus: () => void
}

/**
 * Subscribe to committed stops and surface each as one OS notification whose
 * click focuses the workbench and stopped session.
 * @param options - events, stop lookup, notification sink, localized titles, and click focus.
 * @returns the disposer; after it runs, no further stop reaches the sink.
 */
export function installDesktopDebugNotifications(options: DesktopDebugNotificationOptions): () => void {
  return options.events.subscribe({}, (event) => {
    if (event.kind !== 'session/stopped' || event.sessionId === undefined) return
    void options.stopSnapshot(event.sessionId).then((snapshot) => {
      if (snapshot !== null) notifyDebugStop(options.notify, snapshot, options.titles, options.focus)
    }, (error: unknown) => {
      // The committed stop already exists; a failed lookup must not crash the
      // shell but is never silent.
      console.warn('desktop debug notifications: stop lookup failed', error)
    })
  })
}
