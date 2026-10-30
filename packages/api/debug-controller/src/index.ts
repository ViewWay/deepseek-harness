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
import { Buffer } from 'node:buffer'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, TypertLookup, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import { DebugError, DebugFrameId, DebugSessionId, DebugSourceReference, DebugThreadId, DebugVariableReference } from '@deepseek-ai/dsh-debug'
import type {
  BreakpointSessionApplication,
  DebugBreakpoint,
  DebugBreakpointInput,
  DebugBreakpointLocation,
  DebugBreakpointLocationsRequest,
  DebugCompletion,
  DebugConsoleOptions,
  DebugConsolePage,
  DebugDisassembleRequest,
  DebugDisassembly,
  DebugEvaluateResult,
  DebugEvent,
  DebugExceptionInfo,
  DebugModulesOptions,
  DebugModulesPage,
  DebugReadMemoryRequest,
  DebugResumeResult,
  DebugScopeInfo,
  DebugSessionInfo,
  DebugSessionOperations,
  DebugSource,
  DebugSourceContent,
  DebugStackTrace,
  DebugThread,
  DebugVariable,
  DebugVariablesOptions,
  DebugVariablesPage,
  DebugWriteMemoryRequest,
  DebugWriteMemoryResult,
  JsonValue,
} from '@deepseek-ai/dsh-debug'
import { DebugEventRing } from './ring.ts'
import type { DebugEventReplay } from './ring.ts'
import { editorVersion, writeEditorText } from './editor-write.ts'
import type { EditorWriteResult } from './editor-write.ts'
import type { DebugEditorScope, DebugReadMemoryWireResult, DebugSessionBackend } from './types.ts'

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
    ctx.effect(() => {
      const unsubscribe = ctx.debug.events.subscribe({}, (event) => {
        this.recordEvent(String(event.sessionId), wireEventOf(event))
      })
      return () => {
        unsubscribe()
      }
    }, 'debugController.recordDebugEvents')
    ctx.inject(['sessions', 'typert', 'sandboxPolicy'], (scope) => {
      scope.typert.lookups.register('debugEditorScope', {
        parameter: 'debugEditorScope',
        wire: 'debugEditorScopeId',
        resource: 'session',
        hostTypeSymbol: '@deepseek-ai/dsh-api-debug-controller#DebugEditorScope',
        wireTypeSymbol: '@deepseek-ai/dsh-session/types#SessionId',
        /* jscpd:ignore-start -- the live-then-stored header resolution is the
           session-scope lookup idiom every scope controller registers; the
           twin in workspace-files is that idiom's first definition. */
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
        /* jscpd:ignore-end */
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
   * Re-run one frame from its start; requires the adapter's
   * `supportsRestartFrame`.
   * @param sessionId - Session to control.
   * @param frameId - The frame to restart, from `inspectStackTrace`.
   */
  @Remote
  executionRestartFrame(sessionId: string, frameId: string): Promise<void> {
    return this.withSessionBackend(sessionId, backend => backend.restartFrame(DebugFrameId(frameId)))
  }

  /**
   * Restart the debuggee from the program start; requires the adapter's
   * `supportsRestartRequest`.
   * @param sessionId - Session to control.
   */
  @Remote
  executionRestart(sessionId: string): Promise<void> {
    return this.withSessionBackend(sessionId, backend => backend.restart())
  }

  /**
   * Terminate the debuggee; requires the adapter's `supportsTerminateRequest`.
   * @param sessionId - Session to control.
   */
  @Remote
  executionTerminate(sessionId: string): Promise<void> {
    return this.withLifecycleBackend(sessionId, backend => backend.terminate())
  }

  /**
   * Disconnect from the adapter, ending the session without touching the
   * debuggee.
   * @param sessionId - Session to control.
   */
  @Remote
  executionDisconnect(sessionId: string): Promise<void> {
    return this.withLifecycleBackend(sessionId, backend => backend.disconnect())
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
   * List every debuggee thread with its stop state.
   * @param sessionId - Session to inspect.
   * @returns Every thread of the debugged process.
   */
  @Remote
  inspectThreads(sessionId: string): Promise<readonly DebugThread[]> {
    return this.withSessionBackend(sessionId, backend => backend.threads())
  }

  /**
   * Read one frame's scope list while stopped.
   * @param sessionId - Session to inspect.
   * @param frameId - The frame whose scopes to read, from `inspectStackTrace`.
   * @returns The frame's scopes in adapter order.
   */
  @Remote
  inspectScopes(sessionId: string, frameId: string): Promise<readonly DebugScopeInfo[]> {
    return this.withSessionBackend(sessionId, backend => backend.scopes(DebugFrameId(frameId)))
  }

  /**
   * Read one page of a variable container's children.
   * @param sessionId - Session to inspect.
   * @param variablesReference - The container to expand, from a scope,
   *   variable, or evaluation result.
   * @param options - Paging and named/indexed filtering.
   * @returns The requested child page plus container totals.
   */
  @Remote
  inspectVariables(sessionId: string, variablesReference: string, options?: DebugVariablesOptions): Promise<DebugVariablesPage> {
    return this.withSessionBackend(sessionId, backend => backend.variables(DebugVariableReference(variablesReference), options))
  }

  /**
   * Assign a value to one variable; requires the adapter's
   * `supportsSetVariable`.
   * @param sessionId - Session to control.
   * @param reference - The container holding the variable.
   * @param name - The variable name within the container.
   * @param value - The assignment source text.
   * @returns The variable as the adapter re-rendered it.
   */
  @Remote
  inspectSetVariable(sessionId: string, reference: string, name: string, value: string): Promise<DebugVariable> {
    return this.withSessionBackend(sessionId, backend => backend.setVariable(DebugVariableReference(reference), name, value))
  }

  /**
   * Assign a value to one expression; requires the adapter's
   * `supportsSetExpression`.
   * @param sessionId - Session to control.
   * @param expression - The assignable expression text.
   * @param value - The assignment source text.
   * @param frameId - The frame context; the stopped frame when omitted.
   * @returns The re-evaluated expression result.
   */
  @Remote
  inspectSetExpression(sessionId: string, expression: string, value: string, frameId?: string): Promise<DebugEvaluateResult> {
    return this.withSessionBackend(sessionId, backend => backend.setExpression(expression, value, frameIdOf(frameId)))
  }

  /**
   * Read completion candidates for a REPL line; requires the adapter's
   * `supportsCompletionsRequest`.
   * @param sessionId - Session to inspect.
   * @param text - The whole REPL line up to the cursor.
   * @param column - The zero-based cursor column within `text`.
   * @param frameId - The frame context; the stopped frame when omitted.
   * @returns The normalized candidates.
   */
  @Remote
  inspectCompletions(sessionId: string, text: string, column: number, frameId?: string): Promise<readonly DebugCompletion[]> {
    return this.withSessionBackend(sessionId, backend => backend.completions(text, column, frameIdOf(frameId)))
  }

  /**
   * Read one stopped thread's exception.
   * @param sessionId - Session to inspect.
   * @param threadId - The thread stopped on an exception, from `inspectThreads`.
   * @returns The adapter's exception report.
   */
  @Remote
  inspectExceptionInfo(sessionId: string, threadId: string): Promise<DebugExceptionInfo> {
    return this.withSessionBackend(sessionId, backend => backend.exceptionInfo(DebugThreadId(threadId)))
  }

  /**
   * Read one page of loaded modules; requires the adapter's
   * `supportsModulesRequest`.
   * @param sessionId - Session to inspect.
   * @param options - Module paging.
   * @returns The requested module page plus whole-process totals.
   */
  @Remote
  inspectModules(sessionId: string, options?: DebugModulesOptions): Promise<DebugModulesPage> {
    return this.withSessionBackend(sessionId, backend => backend.modules(options))
  }

  /**
   * List every source the adapter reports as loaded.
   * @param sessionId - Session to inspect.
   * @returns The loaded sources.
   */
  @Remote
  inspectLoadedSources(sessionId: string): Promise<readonly DebugSource[]> {
    return this.withSessionBackend(sessionId, backend => backend.loadedSources())
  }

  /**
   * Fetch one dynamic source's content.
   * @param sessionId - Session to inspect.
   * @param sourceReference - The content reference the stack, modules, or
   *   loaded-source list reported.
   * @returns The source text.
   */
  @Remote
  inspectSource(sessionId: string, sourceReference: string): Promise<DebugSourceContent> {
    return this.withSessionBackend(sessionId, backend => backend.source(DebugSourceReference(sourceReference)))
  }

  /**
   * Resolve the legal breakpoint positions of one source range.
   * @param sessionId - Session to inspect.
   * @param request - The source and line range to resolve.
   * @returns The adapter-resolved positions, in adapter order.
   */
  @Remote
  inspectBreakpointLocations(sessionId: string, request: DebugBreakpointLocationsRequest): Promise<readonly DebugBreakpointLocation[]> {
    return this.withSessionBackend(sessionId, backend => backend.breakpointLocations(request))
  }

  /**
   * Disassemble one instruction range; requires the adapter's
   * `supportsDisassembleRequest`.
   * @param sessionId - Session to inspect.
   * @param request - The memory anchor, range, and symbol resolution flags.
   * @returns The disassembled instructions.
   */
  @Remote
  inspectDisassemble(sessionId: string, request: DebugDisassembleRequest): Promise<DebugDisassembly> {
    return this.withSessionBackend(sessionId, backend => backend.disassemble(request))
  }

  /**
   * Read debuggee memory; requires the adapter's
   * `supportsReadMemoryRequest`. The wire result carries the bytes as
   * base64 with the standard alphabet because the Remote boundary moves
   * JSON only.
   * @param sessionId - Session to inspect.
   * @param request - The memory anchor, byte count, and optional offset.
   * @returns The resolved address, the base64-encoded bytes read, and any
   *   unreadable tail count.
   */
  @Remote
  inspectReadMemory(sessionId: string, request: DebugReadMemoryRequest): Promise<DebugReadMemoryWireResult> {
    return this.withSessionBackend(sessionId, async (backend) => {
      const read = await backend.readMemory(request)
      return {
        ...(read.address === undefined ? {} : { address: read.address }),
        data: Buffer.from(read.data).toString('base64'),
        ...(read.unreadableBytes === undefined ? {} : { unreadableBytes: read.unreadableBytes }),
      }
    })
  }

  /**
   * Write debuggee memory; requires the adapter's
   * `supportsWriteMemoryRequest`. The request's `data` is base64 with the
   * standard alphabet, matching the seam's DAP semantics.
   * @param sessionId - Session to control.
   * @param request - The memory anchor, base64 bytes, optional offset, and
   *   partial-write allowance.
   * @returns The offset and byte count the adapter reported for the write.
   */
  @Remote
  inspectWriteMemory(sessionId: string, request: DebugWriteMemoryRequest): Promise<DebugWriteMemoryResult> {
    return this.withSessionBackend(sessionId, backend => backend.writeMemory(request))
  }

  /**
   * Read one page of the session's console output.
   * @param sessionId - Session to inspect.
   * @param options - Cursor paging over the console history.
   * @returns The requested console page plus the next cursor.
   */
  @Remote
  inspectConsole(sessionId: string, options?: DebugConsoleOptions): Promise<DebugConsolePage> {
    return this.withSessionBackend(sessionId, backend => backend.console(options))
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

  private withSessionBackend<T>(sessionId: string, operate: (backend: DebugSessionOperations) => Promise<T>): Promise<T> {
    const backend = this.ctx.debug.backendOf(DebugSessionId(sessionId))
    if (backend === undefined) {
      return Promise.reject(new DebugError('debug session is not active: ' + sessionId, 'DEBUG_SESSION_GONE'))
    }
    return operate(backend)
  }

  /**
   * Drive one lifecycle control (terminate, disconnect) on the registered
   * backend. The production registrant is `DapDebugBackend`, which satisfies
   * {@link DebugSessionBackend} structurally; the registry's wider declared
   * face is narrowed here.
   * @param sessionId - Session to control.
   * @param operate - The lifecycle control to run.
   * @returns the settled control.
   */
  private withLifecycleBackend(sessionId: string, operate: (backend: DebugSessionBackend) => Promise<void>): Promise<void> {
    return this.withSessionBackend(sessionId, registered => operate(registered as DebugSessionBackend))
  }
}

/**
 * Render one live debug event as the ring's wire-safe JSON payload.
 * @param event - the committed live event.
 * @returns the same fact with interface-typed members spread into plain JSON objects.
 */
function wireEventOf(event: DebugEvent): JsonValue {
  switch (event.kind) {
    case 'breakpoint/changed':
      return {
        ...event,
        result: {
          applied: event.result.applied.map(wireBreakpointOf),
          rejected: event.result.rejected.map(wireBreakpointOf),
        },
      }
    case 'capabilities/changed':
      return { ...event, capabilities: { ...event.capabilities } }
    case 'session/owner-changed':
      return { ...event, from: { ...event.from }, to: { ...event.to } }
    case 'session/starting':
    case 'session/running':
    case 'session/stopped':
    case 'session/terminated':
    case 'session/failed':
    case 'console/output':
    case 'adapter/output':
      return { ...event }
  }
}

/** Spread one breakpoint and its source into plain JSON objects. */
function wireBreakpointOf(breakpoint: DebugBreakpoint): JsonValue {
  return { ...breakpoint, source: { ...breakpoint.source } }
}

/** Re-brand a wire frame id; the stopped frame when omitted. */
function frameIdOf(frameId: string | undefined): DebugFrameId | undefined {
  return frameId === undefined ? undefined : DebugFrameId(frameId)
}
