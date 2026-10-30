/**
 * The debug view client service: the live store behind the debug toolbar,
 * seeded from the debug controller's session list and kept current by
 * polling the controller's event replay ring, plus the toolbar action
 * dispatch onto the controller's execution Remotes.
 *
 * Transport is polling, not forwarded events, because the Remote carrier's
 * forwarded-event allowlist has no `debug/*` entry; the replay ring's
 * monotonic per-session cursor makes one interval tick per session an
 * honest transport. A cursor the ring has outgrown resets to zero and the
 * next tick refolds the retained history (console entries may repeat once).
 * Failures surface as notices instead of stopping the poll or the dispatch.
 *
 * Toolbar actions map one-to-one onto the controller's execution Remotes.
 * `start`, `restart`, `stop`, and `disconnect` have no controller Remote
 * yet, so they surface an `action-unavailable` notice rather than silently
 * doing nothing; the switch is the one place that mapping grows when the
 * controller gains them.
 * @module @deepseek-ai/dsh-client-ui-debug/debug-service
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { RemoteFailure, RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the generated Remote API and ctx.remote merge through the Client assembly boundary.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import { createDebugViewStore } from './store.ts'
import type { DebugAction, DebugViewStore } from './store.ts'
import { debugViewEventOf } from './wire-events.ts'

/** Notices the service keeps before the oldest drops off. */
const NOTICES_BOUND = 20

/**
 * One surfaced failure of the debug view's Remote traffic.
 */
export interface DebugViewNotice {
  /** What failed: an action the controller cannot serve, an action it refused, or the poll. */
  readonly reason: 'action-unavailable' | 'action-failed' | 'poll-failed'
  /** Diagnostic message naming the action or session and the failure. */
  readonly message: string
}

/** External-store face over the bounded notice ring. */
export interface DebugViewNotices {
  /**
   * Read the surfaced failures.
   * @returns the notices, oldest first, bounded to the newest.
   */
  getSnapshot(): readonly DebugViewNotice[]
  /**
   * Subscribe to notice changes.
   * @param listener - notified after every report and drop.
   * @returns the disposer removing this listener.
   */
  subscribe(listener: () => void): () => void
}

/** The debug view client service the workbench wiring and panels consume. */
export interface DebugViewService {
  /** The live view store; folds every replayed ring event. */
  readonly store: DebugViewStore
  /** The bounded failures of actions and polling. */
  readonly notices: DebugViewNotices
  /**
   * Dispatch one toolbar action against one debug session.
   * @param action - the toolbar gesture.
   * @param sessionId - the session the gesture addresses; an empty string
   *   reports `action-unavailable`, because no session is selected.
   */
  onAction(action: DebugAction, sessionId: string): void
}

/**
 * Create the debug view client service and start its poll.
 * @param ctx - client root context carrying the `remote.debug` namespace.
 * @param pollMs - event poll interval; the plugin's validated `Config`
 *   enforces the minimum.
 * @returns the service; disposal of the passed context stops the poll.
 */
export function createDebugViewService(ctx: ClientContext, pollMs: number): DebugViewService {
  const store = createDebugViewStore()
  const noticeListeners = new Set<() => void>()
  let notices: readonly DebugViewNotice[] = []
  const report = (reason: DebugViewNotice['reason'], message: string): void => {
    notices = [...notices, { reason, message }].slice(-NOTICES_BOUND)
    for (const listener of [...noticeListeners]) listener()
  }
  const noticeFace: DebugViewNotices = {
    getSnapshot: () => notices,
    subscribe(listener) {
      noticeListeners.add(listener)
      return () => { noticeListeners.delete(listener) }
    },
  }
  /** Per-session replay cursor; a session's first read starts at zero. */
  const cursors = new Map<string, number>()

  /**
   * Read the session list and fold each session's state, so the toolbar's
   * session selector lists sessions the event ring has not mentioned.
   */
  const refreshSessions = async (): Promise<void> => {
    const result = await ctx.remote.debug.sessionList()
    if (!result.ok) {
      report('poll-failed', `debug session list failed: ${result.error.message}`)
      return
    }
    for (const info of result.value) {
      store.apply({ kind: 'session/state', sessionId: info.id, state: info.state })
    }
  }

  /**
   * The replay cursor fell behind the ring's retention. The controller
   * throws its domain error, which the Remote wire folds to
   * `gateway/internal` with the message intact, so the stable message prefix
   * is the wire-visible signal until the controller migrates to RemoteError.
   */
  const cursorExpired = (error: RemoteFailure): boolean =>
    error.message.startsWith('debug event cursor expired')

  /**
   * Replay one session's new ring records and fold them.
   * @param sessionId - the session whose events to read.
   */
  const replaySession = async (sessionId: string): Promise<void> => {
    const after = cursors.get(sessionId) ?? 0
    const result = await ctx.remote.debug.events(sessionId, after)
    if (!result.ok) {
      if (cursorExpired(result.error)) {
        cursors.set(sessionId, 0)
        return
      }
      report('poll-failed', `debug events for ${sessionId} failed: ${result.error.message}`)
      return
    }
    for (const record of result.value.records) {
      const event = debugViewEventOf(record.seq, record.payload)
      if (event !== undefined) store.apply(event)
    }
    cursors.set(sessionId, Math.max(after, result.value.latestSeq))
  }

  let ticking = false
  /**
   * One poll tick: refresh the session list, then replay every known
   * session's new events. A tick already in flight ignores later fires, so a
   * slow Host cannot stack requests.
   */
  const tick = async (): Promise<void> => {
    if (ticking) return
    ticking = true
    try {
      await refreshSessions()
      for (const sessionId of Object.keys(store.state.sessionStates)) await replaySession(sessionId)
    } catch (error: unknown) {
      // Only an assembly fault (an unmounted method) rejects past the folded
      // RemoteResult; name it and keep the interval alive.
      report('poll-failed', `debug event poll failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      ticking = false
    }
  }

  ctx.effect(() => {
    void tick()
    const timer = setInterval(() => { void tick() }, pollMs)
    return () => { clearInterval(timer) }
  }, 'ui-debug: debug view event poll')

  /**
   * Await one dispatched Remote call and surface its failure.
   * @param action - the gesture that issued the call, naming the notice.
   * @param call - the Remote invocation.
   */
  const dispatchResult = async (action: DebugAction, call: () => Promise<RemoteResult<unknown>>): Promise<void> => {
    try {
      const result = await call()
      if (!result.ok) report('action-failed', `${action}: ${result.error.message}`)
    } catch (error: unknown) {
      report('action-failed', `${action}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const onAction = (action: DebugAction, sessionId: string): void => {
    if (sessionId === '') {
      report('action-unavailable', `${action}: no debug session is selected`)
      return
    }
    switch (action) {
      case 'continue':
        return void dispatchResult(action, () => ctx.remote.debug.executionContinue(sessionId))
      case 'pause':
        return void dispatchResult(action, () => ctx.remote.debug.executionPause(sessionId))
      case 'stepOver':
        return void dispatchResult(action, () => ctx.remote.debug.executionStep(sessionId, 'over'))
      case 'stepIn':
        return void dispatchResult(action, () => ctx.remote.debug.executionStep(sessionId, 'in'))
      case 'stepOut':
        return void dispatchResult(action, () => ctx.remote.debug.executionStep(sessionId, 'out'))
      case 'stepBack':
        return void dispatchResult(action, () => ctx.remote.debug.executionStep(sessionId, 'back'))
      case 'restartFrame': {
        const frameId = store.state.selectedFrameId
        if (frameId === undefined) {
          report('action-unavailable', `${action}: no stack frame is selected`)
          return
        }
        return void dispatchResult(action, () => ctx.remote.debug.executionRestartFrame(sessionId, frameId))
      }
      case 'start':
      case 'restart':
      case 'stop':
      case 'disconnect':
        report('action-unavailable', `${action}: the debug controller exposes no Remote for this action yet`)
        return
      /* v8 ignore next -- closed DebugAction union exhaustiveness guard */
      default: return assertNever(action)
    }
  }

  return { store, notices: noticeFace, onAction }
}
