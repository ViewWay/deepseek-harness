/**
 * Authenticated Remote operations for Web/Desktop debug consumers.
 *
 * Method groups follow the design's resource split: `session` (list and
 * read), `execution` (control), `inspect` (stacks, variables, evaluation),
 * and `breakpoints` (per-file sets). `events` replays one session's
 * sequenced events after a monotonic `debugEventSeq` cursor from a bounded
 * ring and continues live; a cursor behind the ring's retention answers with
 * the `debug/event-cursor-expired` flow-control code so clients resynchronize.
 * Editor file writes are a separate controller's concern.
 * @module @deepseek-ai/dsh-api-debug-controller
 */
import { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { DebugError, DebugSessionId } from '@deepseek-ai/dsh-debug'
import type { DebugBreakpointInput, DebugSessionInfo } from '@deepseek-ai/dsh-debug'
import { DebugEventRing } from './ring.ts'
import type { DebugEventReplay } from './ring.ts'

/** Default replay retention; compositions pass their configured bound. */
export const DEFAULT_DEBUG_EVENT_RING_LIMIT = 500

/** Remote-layer flow control: the caller's event cursor fell out of the ring. */
export class DebugEventCursorExpiredError extends Error {
  /** The stable flow-control code clients route on. */
  override readonly name = 'DebugEventCursorExpiredError'
  readonly code = 'debug/event-cursor-expired'

  /**
   * @param sessionId - Session whose replay cursor expired.
   */
  constructor(sessionId: string) {
    super('debug event cursor expired for session ' + sessionId)
  }
}

/** Remote-facing debug controller. */
export class DebugController extends TypertRemoteService {
  static inject = ['debug']

  private readonly ring: DebugEventRing

  /**
   * @param ctx - Host with the debug service mounted.
   */
  constructor(ctx: Context, ringLimit: number = DEFAULT_DEBUG_EVENT_RING_LIMIT) {
    super(ctx, 'debugController', { namespace: 'debug' })
    this.ring = new DebugEventRing(ringLimit)
  }

  /** Record one live debug event into the replay ring. */
  recordEvent(sessionId: string, payload: unknown): number {
    return this.ring.append(sessionId, payload)
  }

  /**
   * List debug sessions visible to the caller.
   * @returns Read-facing session infos.
   */
  @Remote
  sessionList(): readonly DebugSessionInfo[] {
    return this.ctx.debug.list()
  }

  /**
   * Continue one stopped thread.
   * @param sessionId - Session to control.
   * @returns The resume outcome: stopped again, terminated, or running.
   */
  @Remote
  executionContinue(sessionId: string): Promise<unknown> {
    return this.withSessionBackend(sessionId, backend => backend.continue())
  }

  /**
   * Pause one running thread.
   * @param sessionId - Session to control.
   */
  @Remote
  executionPause(sessionId: string): Promise<void> {
    return this.withSessionBackend(sessionId, backend => backend.pause())
  }

  /**
   * Step one stopped thread.
   * @param sessionId - Session to control.
   * @param kind - Step direction.
   * @returns The resume outcome.
   */
  @Remote
  executionStep(sessionId: string, kind: 'over' | 'in' | 'out' | 'back'): Promise<unknown> {
    return this.withSessionBackend(sessionId, backend => backend.step(kind))
  }

  /**
   * Read one thread's stack while stopped.
   * @param sessionId - Session to inspect.
   * @returns The stack page.
   */
  @Remote
  inspectStackTrace(sessionId: string): Promise<unknown> {
    return this.withSessionBackend(sessionId, backend => backend.currentThreadStack())
  }

  /**
   * Evaluate one expression in the current stop context.
   * @param sessionId - Session to inspect.
   * @param expression - Expression text.
   * @returns The evaluation result.
   */
  @Remote
  inspectEvaluate(sessionId: string, expression: string): Promise<unknown> {
    return this.withSessionBackend(sessionId, backend => backend.evaluate(expression, 'repl'))
  }

  /**
   * Replace one file's breakpoints.
   * @param workspaceId - Owning workspace.
   * @param path - Workspace-relative file path.
   * @param breakpoints - Complete replacement set.
   * @returns Per-session application results.
   */
  @Remote
  breakpointsSetFile(workspaceId: string, path: string, breakpoints: readonly DebugBreakpointInput[]): Promise<unknown> {
    return this.ctx.debug.breakpoints.setFile(workspaceId, path, breakpoints)
  }

  /**
   * Replay one session's events after a cursor, then continue live.
   * @param sessionId - Session whose events to read.
   * @param after - The caller's last seen `debugEventSeq`.
   * @returns The retained slice and the newest cursor.
   * @throws DebugError(`debug/event-cursor-expired`) when the cursor fell
   *   behind the ring's retention; clients resynchronize from the snapshot.
   */
  @Remote
  events(sessionId: string, after: number): DebugEventReplay {
    const replay = this.ring.replay(sessionId, after)
    if (replay.expired) {
      throw new DebugEventCursorExpiredError(sessionId)
    }
    return replay
  }

  private withSessionBackend<T>(sessionId: string, operate: (backend: DebugSessionBackend) => Promise<T>): Promise<T> {
    const backend = this.ctx.debug.backendOf<DebugSessionBackend>(DebugSessionId(sessionId))
    if (backend === undefined) {
      return Promise.reject(new DebugError('debug session is not active: ' + sessionId, 'DEBUG_SESSION_GONE'))
    }
    return operate(backend)
  }
}

/** The session-backend slice this controller drives. */
export interface DebugSessionBackend {
  continue(): Promise<unknown>
  pause(): Promise<void>
  step(kind: 'over' | 'in' | 'out' | 'back'): Promise<unknown>
  currentThreadStack(): Promise<unknown>
  evaluate(expression: string, context: string): Promise<unknown>
}
