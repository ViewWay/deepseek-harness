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
import z from '@deepseek-ai/schemastery'
import { Remote, TypertLookup, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import { DebugError, DebugSessionId } from '@deepseek-ai/dsh-debug'
import type { BreakpointSessionApplication, DebugBreakpointInput, DebugEvaluateResult, DebugResumeResult, DebugSessionInfo, DebugStackTrace, JsonValue } from '@deepseek-ai/dsh-debug'
import { DebugEventRing } from './ring.ts'
import type { DebugEventReplay } from './ring.ts'
import { editorVersion, writeEditorText } from './editor-write.ts'
import type { EditorWriteResult } from './editor-write.ts'
import type { DebugEditorScope, DebugSessionBackend } from './types.ts'

export type { DebugEditorScope, DebugSessionBackend } from './types.ts'

/** Default replay retention; compositions pass their configured bound. */
export const DEFAULT_DEBUG_EVENT_RING_LIMIT = 500

/** Debug Controller deployment policy. */
export interface Config {
  /** Replay ring capacity in events per composition (default {@link DEFAULT_DEBUG_EVENT_RING_LIMIT}). */
  readonly eventRingLimit?: number
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertLookupMap {
    /** Resolve a Session id to its editor workspace root without loading its event body. */
    debugEditorScope: TypertLookup<DebugEditorScope, SessionId>
  }
}

/** Remote-layer flow control: the caller's event cursor fell out of the ring. */
export class DebugEventCursorExpiredError extends Error {
  /** The stable flow-control code clients route on. */
  override readonly name = 'DebugEventCursorExpiredError'
  /** Stable error code the Remote client routes on for replay recovery. */
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
  static inject = ['debug', 'fs', 'sandboxPolicy', 'sessions', 'typert']

  static Config: z<Config> = z.object({
    eventRingLimit: z.natural().min(1).default(DEFAULT_DEBUG_EVENT_RING_LIMIT),
  })

  private readonly ring: DebugEventRing

  /**
   * @param ctx - Host with the debug service mounted.
   * @param config - replay retention policy; schemastery has filled the
   *   defaulted fields before this constructor runs.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'debugController', { namespace: 'debug' })
    const resolved = config as Required<Config>
    this.ring = new DebugEventRing(resolved.eventRingLimit)
    ctx.inject(['sessions', 'typert', 'sandboxPolicy'], (scope) => {
      scope.typert.lookups.register('debugEditorScope', {
        parameter: 'debugEditorScope',
        wire: 'debugEditorScopeId',
        resource: 'session',
        hostTypeSymbol: '@deepseek-ai/dsh-api-debug-controller#DebugEditorScope',
        wireTypeSymbol: '@deepseek-ai/dsh-session/types#SessionId',
        resolve: async (sessionId) => {
          const live = scope.sessions.get(sessionId)?.header
          const stored = live === undefined
            ? await scope.get('sessionPersistence')?.stat(sessionId)
            : undefined
          const header = live ?? stored?.header
          if (header === undefined) return undefined
          return {
            sessionId,
            workspaceRoot: header.cwd ?? scope.sandboxPolicy.workspaceRoot,
          }
        },
      })
    })
  }

  /**
   * Record one live debug event into the replay ring.
   * @param sessionId - Session whose debug surface produced the event.
   * @param payload - The normalized event payload.
   * @returns The event's ring sequence number.
   */
  recordEvent(sessionId: string, payload: JsonValue): number {
    return this.ring.append(sessionId, payload)
  }

  /**
   * Save one editor file through the filesystem's version guard. The
   * workspace root arrives host-resolved from the session header via the
   * `debugEditorScope` lookup — the wire carries only the session identity,
   * never a client-chosen root.
   * @param debugEditorScope - header-derived workspace root for the session
   *   identity on the wire.
   * @param path - Workspace-relative path; escaping paths reject before any
   *   filesystem access.
   * @param content - Full replacement text.
   * @param expectedVersion - The version the editor opened, or null to
   *   create-only (an existing target conflicts and is never overwritten).
   * @returns The new version, byte count, and create/update outcome.
   */
  @Remote
  writeText(
    debugEditorScope: DebugEditorScope,
    path: string,
    content: string,
    expectedVersion: string | null,
  ): Promise<EditorWriteResult> {
    return writeEditorText({
      sessionId: String(debugEditorScope.sessionId),
      workspaceRoot: debugEditorScope.workspaceRoot,
      path,
      content,
      expectedVersion: expectedVersion === null ? null : editorVersion(expectedVersion),
      fs: this.ctx.fs,
    })
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
  executionContinue(sessionId: string): Promise<DebugResumeResult> {
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
  executionStep(sessionId: string, kind: 'over' | 'in' | 'out' | 'back'): Promise<DebugResumeResult> {
    return this.withSessionBackend(sessionId, backend => backend.step(kind))
  }

  /**
   * Read one thread's stack while stopped.
   * @param sessionId - Session to inspect.
   * @returns The stack page.
   */
  @Remote
  inspectStackTrace(sessionId: string): Promise<DebugStackTrace> {
    return this.withSessionBackend(sessionId, backend => backend.currentThreadStack())
  }

  /**
   * Evaluate one expression in the current stop context.
   * @param sessionId - Session to inspect.
   * @param expression - Expression text.
   * @returns The evaluation result.
   */
  @Remote
  inspectEvaluate(sessionId: string, expression: string): Promise<DebugEvaluateResult> {
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
  breakpointsSetFile(
    workspaceId: string,
    path: string,
    breakpoints: readonly DebugBreakpointInput[],
  ): Promise<readonly BreakpointSessionApplication[]> {
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
