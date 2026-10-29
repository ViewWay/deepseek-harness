/**
 * The DAP-backed `DebugSessionBackend`: explicit debug operations translated
 * to DAP commands, with stop tracking, capability gating, stale-reference
 * detection, reverse-request routing, and a bounded console ring.
 *
 * Policy: every breakpoint `set*` maps adapter refusals onto rejected
 * breakpoints instead of throwing; every other command the adapter explicitly
 * rejects fails with `DEBUG_LAUNCH_FAILED` carrying the adapter's message.
 * Inspection while not stopped rejects with `DEBUG_NOT_STOPPED`; frame and
 * variable references from an earlier suspension reject with
 * `DEBUG_STALE_REFERENCE`; operations the adapter never declared reject with
 * `DEBUG_UNSUPPORTED_CAPABILITY` before anything is sent.
 * @module @deepseek-ai/dsh-debug-dap/backend
 */
import { DebugError, DebugBreakpointId, DebugFrameId, DebugSessionId, DebugSourceReference, DebugThreadId, DebugVariableReference } from '@deepseek-ai/dsh-debug'
import type {
  DebugBreakpoint,
  DebugBreakpointInput,
  DebugBreakpointResult,
  DebugBreakpointSetRequest,
  DebugCapabilities,
  DebugCompletion,
  DebugConsoleCategory,
  DebugConsoleEntry,
  DebugConsoleOptions,
  DebugConsolePage,
  DebugDataBreakpointRequest,
  DebugDisassembleRequest,
  DebugDisassembly,
  DebugEvaluateContext,
  DebugEvaluateResult,
  DebugExceptionBreakpointRequest,
  DebugExceptionInfo,
  DebugFunctionBreakpointRequest,
  DebugInstructionBreakpointRequest,
  DebugModulesOptions,
  DebugModulesPage,
  DebugOperationOptions,
  DebugResumeResult,
  DebugScopeInfo,
  DebugSource,
  DebugSourceContent,
  DebugStackFrame,
  DebugStackTrace,
  DebugStackTraceOptions,
  DebugStepKind,
  DebugSteppingGranularity,
  DebugStopSnapshot,
  DebugThread,
  DebugVariable,
  DebugVariablesOptions,
  DebugVariablesPage,
  DebugWriteMemoryRequest,
  JsonValue,
} from '@deepseek-ai/dsh-debug'
import { isJsonObject } from './capabilities.ts'
import { initializeDebugAdapter, mapStopReason, type DebugHandshakePlan } from './handshake.ts'
import type { DapArguments, DapEvent, DapRequest } from './frames.ts'
import type { DapClient } from './client.ts'

/** Handlers for adapter-initiated reverse requests. */
export interface DapReverseRequestHandlers {
  /** Answers `runInTerminal`; resolves with the response body. */
  runInTerminal?: (request: DapRequest) => Promise<DapArguments>
  /** Answers `startDebugging`; resolves with the response body. */
  startDebugging?: (request: DapRequest) => Promise<DapArguments>
}

/** Construction-time configuration of one backend. */
export interface DapDebugBackendOptions {
  /** Session the backend serves; stamped onto every stop snapshot. */
  readonly sessionId: DebugSessionId
  /** Workspace root used to relativize frame source paths. */
  readonly workspaceRoot: string
  /** Per-request timeout in milliseconds. */
  readonly requestTimeoutMs: number
  /** How long `continue`/`step` wait for the next stop before `running`. */
  readonly resumeTimeoutMs: number
  /** Console ring capacity; older entries are dropped once the ring fills. */
  readonly consoleLimit: number
  /** Reverse-request handlers; see {@link DapReverseRequestHandlers}. */
  readonly reverseRequests?: DapReverseRequestHandlers
}

/** Default console ring capacity when the session layer configures none. */
export const DEFAULT_CONSOLE_LIMIT = 200

const STEP_COMMANDS: Readonly<Record<DebugStepKind, string>> = {
  over: 'next',
  in: 'stepIn',
  out: 'stepOut',
  back: 'stepBack',
}

const CONSOLE_CATEGORIES: Readonly<Record<string, DebugConsoleCategory>> = {
  console: 'console',
  important: 'important',
  stdout: 'stdout',
  stderr: 'stderr',
  telemetry: 'telemetry',
}

const BREAK_MODES: Readonly<Record<string, DebugExceptionInfo['breakMode']>> = {
  never: 'never',
  always: 'always',
  unhandled: 'unhandled',
  userUnhandled: 'userUnhandled',
  all: 'all',
}

interface ResumeWaiter {
  readonly resolve: (result: DebugResumeResult) => void
}

/**
 * One debug session's DAP operations. Call `start` once after construction;
 * every later method translates to DAP commands over the client.
 */
export class DapDebugBackend {
  private readonly client: DapClient
  private readonly options: DapDebugBackendOptions
  private readonly consoleRing: DebugConsoleEntry[] = []
  private readonly frameGenerations = new Map<number, number>()
  private readonly variableGenerations = new Map<number, number>()
  private capabilities: DebugCapabilities | undefined
  private stopSnapshot: DebugStopSnapshot | undefined
  private stopSettling: Promise<void> | undefined
  private resumeWaiter: ResumeWaiter | undefined
  private terminated = false
  private consoleBase = 0
  private generation = 0
  private eventEpoch = 0

  /**
   * @param client Client wired to the adapter.
   * @param options Session identity, timeouts, ring bound, and handlers.
   */
  constructor(client: DapClient, options: DapDebugBackendOptions) {
    this.client = client
    this.options = options
    client.onEvent((event) => { this.handleEvent(event) })
    client.onReverseRequest(request => this.handleReverseRequest(request))
  }

  /**
   * Runs the handshake and enters the post-launch state.
   *
   * @param plan Handshake configuration; see {@link DebugHandshakePlan}.
   */
  async start(plan: DebugHandshakePlan): Promise<void> {
    const result = await initializeDebugAdapter(this.client, plan)
    this.capabilities = result.capabilities
    if (result.firstStop !== undefined) await this.stopSettling
  }

  /**
   * Replaces one source's breakpoints.
   *
   * @param request Source and requested breakpoints.
   * @returns Applied (verified) and rejected breakpoints, never raw DAP.
   */
  async setBreakpoints(request: DebugBreakpointSetRequest): Promise<DebugBreakpointResult> {
    const body = await this.request('setBreakpoints', {
      source: { path: request.source.absolutePath },
      breakpoints: request.breakpoints.map(toWireBreakpoint),
    })
    const verified = wireBreakpoints(body)
    return partitionBreakpoints(request.breakpoints, verified, request.source)
  }

  /**
   * Replaces exception breakpoints.
   *
   * @param request Adapter filter ids to activate.
   * @returns Empty result: filters carry no per-breakpoint verification.
   */
  async setExceptionBreakpoints(request: DebugExceptionBreakpointRequest): Promise<DebugBreakpointResult> {
    await this.request('setExceptionBreakpoints', { filters: request.filters })
    return { applied: [], rejected: [] }
  }

  /**
   * Replaces function breakpoints; requires `supportsFunctionBreakpoints`.
   *
   * @param request Function breakpoints to set.
   * @returns Applied and rejected breakpoints.
   */
  async setFunctionBreakpoints(request: DebugFunctionBreakpointRequest): Promise<DebugBreakpointResult> {
    this.requireCapability('supportsFunctionBreakpoints')
    const body = await this.request('setFunctionBreakpoints', {
      breakpoints: request.breakpoints.map(breakpoint => ({
        name: breakpoint.name,
        ...(breakpoint.condition === undefined ? {} : { condition: breakpoint.condition }),
        ...(breakpoint.hitCondition === undefined ? {} : { hitCondition: breakpoint.hitCondition }),
      })),
    })
    const verified = wireBreakpoints(body)
    const applied = verified
      .filter(entry => entry.verified)
      .map(entry => functionBreakpoint(entry))
    return { applied, rejected: [] }
  }

  /**
   * Replaces data breakpoints; requires `supportsDataBreakpoints`.
   *
   * @param request Data breakpoints to set.
   * @returns Applied breakpoints; adapter refusals reject the whole set.
   */
  async setDataBreakpoints(request: DebugDataBreakpointRequest): Promise<DebugBreakpointResult> {
    this.requireCapability('supportsDataBreakpoints')
    await this.request('setDataBreakpoints', {
      breakpoints: request.breakpoints.map(breakpoint => ({
        dataId: breakpoint.dataId,
        ...(breakpoint.bytes === undefined ? {} : { bytes: breakpoint.bytes }),
        ...breakpointConditions(breakpoint),
      })),
    })
    return { applied: [], rejected: [] }
  }

  /**
   * Replaces instruction breakpoints; requires `supportsInstructionBreakpoints`.
   *
   * @param request Instruction breakpoints to set.
   * @returns Empty result until adapters report per-address verification.
   */
  async setInstructionBreakpoints(request: DebugInstructionBreakpointRequest): Promise<DebugBreakpointResult> {
    this.requireCapability('supportsInstructionBreakpoints')
    await this.request('setInstructionBreakpoints', {
      breakpoints: request.breakpoints.map(breakpoint => ({
        instructionReference: breakpoint.instructionReference,
        ...(breakpoint.offset === undefined ? {} : { offset: breakpoint.offset }),
        ...breakpointConditions(breakpoint),
      })),
    })
    return { applied: [], rejected: [] }
  }

  /**
   * Resumes execution and waits for the next stop or termination.
   *
   * @param threadId Thread to resume; omit to resume the stopped thread.
   * @param options Operation options; the signal aborts the wait.
   * @returns The next stop, termination, or `running` on wait timeout.
   */
  async continue(threadId?: DebugThreadId, options?: DebugOperationOptions): Promise<DebugResumeResult> {
    return this.resume('continue', { ...(threadId === undefined ? {} : { threadId: wireId(threadId) }) }, options?.signal)
  }

  /**
   * Steps execution; `back` requires `supportsStepBack`.
   *
   * @param kind Step direction.
   * @param threadId Thread to step; omit to step the stopped thread.
   * @param granularity Statement, line, or instruction stepping.
   * @returns The next stop, termination, or `running` on wait timeout.
   */
  async step(kind: DebugStepKind, threadId?: DebugThreadId, granularity?: DebugSteppingGranularity): Promise<DebugResumeResult> {
    if (kind === 'back') this.requireCapability('supportsStepBack')
    return this.resume(STEP_COMMANDS[kind], {
      ...(threadId === undefined ? {} : { threadId: wireId(threadId) }),
      ...(granularity === undefined ? {} : { granularity }),
    })
  }

  /**
   * Requests a pause; the stop surfaces through the next stop snapshot.
   *
   * @param threadId Thread to pause; omit for the stopped thread.
   */
  async pause(threadId?: DebugThreadId): Promise<void> {
    await this.request('pause', { ...(threadId === undefined ? {} : { threadId: wireId(threadId) }) })
  }

  /**
   * Restarts one frame; requires `supportsRestartFrame` and a current frame.
   *
   * @param frameId Frame to restart, from the current suspension.
   */
  async restartFrame(frameId: DebugFrameId): Promise<void> {
    this.requireCapability('supportsRestartFrame')
    this.requireStopped()
    this.requireCurrentFrame(frameId)
    await this.request('restartFrame', { frameId: wireId(frameId) })
  }

  /**
   * Restarts the session's debuggee; requires `supportsRestartRequest`.
   */
  async restart(): Promise<void> {
    this.requireCapability('supportsRestartRequest')
    await this.request('restart', {})
  }

  /**
   * Terminates the debuggee; requires `supportsTerminateRequest`.
   */
  async terminate(): Promise<void> {
    this.requireCapability('supportsTerminateRequest')
    await this.request('terminate', {})
    this.terminated = true
  }

  /** Disconnects from the adapter, ending the session. */
  async disconnect(): Promise<void> {
    await this.request('disconnect', {})
    this.terminated = true
  }

  /**
   * Lists the debuggee's threads.
   *
   * @returns All threads as the adapter reported them.
   */
  async threads(): Promise<readonly DebugThread[]> {
    const body = await this.request('threads', {})
    const threads = Array.isArray(isJsonObject(body) ? body['threads'] : undefined) ? (isJsonObject(body) ? body['threads'] : []) as readonly JsonValue[] : []
    return threads.map((thread) => {
      const record = isJsonObject(thread) ? thread : {}
      return {
        id: DebugThreadId(String(wireNumber(record['id'], 'threads[].id'))),
        name: wireString(record['name'], 'threads[].name'),
      }
    })
  }

  /**
   * Reads one thread's stack; requires a current suspension.
   *
   * @param threadId Thread whose stack to read.
   * @param options Paging into the frame list.
   * @returns The requested frame slice and whole-stack totals.
   */
  async stackTrace(threadId: DebugThreadId, options?: DebugStackTraceOptions): Promise<DebugStackTrace> {
    this.requireStopped()
    const body = await this.request('stackTrace', {
      threadId: wireId(threadId),
      ...(options?.startFrame === undefined ? {} : { startFrame: options.startFrame }),
      ...(options?.levels === undefined ? {} : { levels: options.levels }),
    })
    const frames = isJsonObject(body) && Array.isArray(body['stackFrames']) ? body['stackFrames'] as readonly JsonValue[] : []
    const totalFrames = wireNumber(isJsonObject(body) ? body['totalFrames'] : undefined, 'stackTrace.totalFrames')
    const mapped = frames.map(frame => this.registerFrame(frame))
    return { frames: mapped, totalFrames, truncated: totalFrames > mapped.length }
  }

  /**
   * Lists one frame's scopes; the frame must come from the current suspension.
   *
   * @param frameId Frame whose scopes to list.
   * @returns Scope names and their variable containers.
   */
  async scopes(frameId: DebugFrameId): Promise<readonly DebugScopeInfo[]> {
    this.requireStopped()
    this.requireCurrentFrame(frameId)
    const body = await this.request('scopes', { frameId: wireId(frameId) })
    const scopes = isJsonObject(body) && Array.isArray(body['scopes']) ? body['scopes'] as readonly JsonValue[] : []
    return scopes.map((scope) => {
      const reference = wireNumber(isJsonObject(scope) ? scope['variablesReference'] : undefined, 'scopes[].variablesReference')
      this.variableGenerations.set(reference, this.generation)
      return {
        name: wireString(isJsonObject(scope) ? scope['name'] : undefined, 'scopes[].name'),
        variablesReference: DebugVariableReference(String(reference)),
        expensive: (isJsonObject(scope) ? scope['expensive'] : undefined) === true,
      }
    })
  }

  /**
   * Reads one container's variables, a single level deep.
   *
   * @param reference Container from a scope, variable, or evaluation.
   * @param options Paging and filtering into the child list.
   * @returns The requested child slice and container totals.
   */
  async variables(reference: DebugVariableReference, options?: DebugVariablesOptions): Promise<DebugVariablesPage> {
    this.requireCurrentVariables(reference)
    const body = await this.request('variables', {
      variablesReference: wireId(reference),
      ...(options?.start === undefined ? {} : { start: options.start }),
      ...(options?.count === undefined ? {} : { count: options.count }),
      ...(options?.filter === undefined ? {} : { filter: options.filter }),
    })
    const variables = isJsonObject(body) && Array.isArray(body['variables']) ? body['variables'] as readonly JsonValue[] : []
    const mapped = variables.map(variable => this.registerVariable(variable))
    return { variables: mapped, total: mapped.length, truncated: false }
  }

  /**
   * Evaluates one expression; requires a current suspension.
   *
   * @param expression Expression text.
   * @param context Where the evaluation runs.
   * @param frameId Frame context; omit for the global context.
   * @returns The rendered value and optional child container.
   */
  async evaluate(expression: string, context: DebugEvaluateContext, frameId?: DebugFrameId): Promise<DebugEvaluateResult> {
    this.requireStopped()
    const body = await this.request('evaluate', {
      expression,
      context,
      ...(frameId === undefined ? {} : { frameId: wireId(frameId) }),
    })
    const record = isJsonObject(body) ? body : {}
    const reference = wireNumber(record['variablesReference'] === undefined ? 0 : record['variablesReference'], 'evaluate.variablesReference')
    this.variableGenerations.set(reference, this.generation)
    return {
      result: wireString(record['result'], 'evaluate.result'),
      ...(typeof record['type'] === 'string' ? { type: record['type'] } : {}),
      variablesReference: DebugVariableReference(String(reference)),
    }
  }

  /**
   * Writes one variable; requires `supportsSetVariable` and a suspension.
   *
   * @param reference Container holding the variable.
   * @param name Variable name within the container.
   * @param value New value expression.
   * @returns The variable as the adapter now reports it.
   */
  async setVariable(reference: DebugVariableReference, name: string, value: string): Promise<DebugVariable> {
    this.requireCapability('supportsSetVariable')
    this.requireStopped()
    this.requireCurrentVariables(reference)
    const body = await this.request('setVariable', { variablesReference: wireId(reference), name, value })
    const record = isJsonObject(body) ? body : {}
    const child = wireNumber(record['variablesReference'] === undefined ? 0 : record['variablesReference'], 'setVariable.variablesReference')
    this.variableGenerations.set(child, this.generation)
    return {
      name: wireString(record['name'], 'setVariable.name'),
      value: wireString(record['value'], 'setVariable.value'),
      ...(typeof record['type'] === 'string' ? { type: record['type'] } : {}),
      variablesReference: DebugVariableReference(String(child)),
    }
  }

  /**
   * Assigns one expression; requires `supportsSetExpression` and a suspension.
   *
   * @param expression Assignable expression.
   * @param value New value expression.
   * @param frameId Frame context; omit for the global context.
   * @returns The evaluated assignment result.
   */
  async setExpression(expression: string, value: string, frameId?: DebugFrameId): Promise<DebugEvaluateResult> {
    this.requireCapability('supportsSetExpression')
    this.requireStopped()
    const body = await this.request('setExpression', {
      expression,
      value,
      ...(frameId === undefined ? {} : { frameId: wireId(frameId) }),
    })
    const record = isJsonObject(body) ? body : {}
    const reference = wireNumber(record['variablesReference'] === undefined ? 0 : record['variablesReference'], 'setExpression.variablesReference')
    this.variableGenerations.set(reference, this.generation)
    return {
      result: wireString(record['result'], 'setExpression.result'),
      ...(typeof record['type'] === 'string' ? { type: record['type'] } : {}),
      variablesReference: DebugVariableReference(String(reference)),
    }
  }

  /**
   * Completes console text; requires `supportsCompletionsRequest`.
   *
   * @param text Text being completed.
   * @param column Column of the completion cursor.
   * @param frameId Frame context; omit for the global context.
   * @returns Completion candidates.
   */
  async completions(text: string, column: number, frameId?: DebugFrameId): Promise<readonly DebugCompletion[]> {
    this.requireCapability('supportsCompletionsRequest')
    const body = await this.request('completions', {
      text,
      column,
      ...(frameId === undefined ? {} : { frameId: wireId(frameId) }),
    })
    const targets = isJsonObject(body) && Array.isArray(body['targets']) ? body['targets'] as readonly JsonValue[] : []
    return targets.map((target) => {
      const record = isJsonObject(target) ? target : {}
      return {
        label: wireString(record['label'], 'completions[].label'),
        ...(typeof record['text'] === 'string' ? { text: record['text'] } : {}),
        ...(typeof record['start'] === 'number' ? { start: record['start'] } : {}),
        ...(typeof record['length'] === 'number' ? { length: record['length'] } : {}),
      }
    })
  }

  /**
   * Reads the stopped thread's exception; requires `supportsExceptionInfoRequest`.
   *
   * @param threadId Thread whose exception to read.
   * @returns The exception identity and detail.
   */
  async exceptionInfo(threadId: DebugThreadId): Promise<DebugExceptionInfo> {
    this.requireCapability('supportsExceptionInfoRequest')
    const body = await this.request('exceptionInfo', { threadId: wireId(threadId) })
    const record = isJsonObject(body) ? body : {}
    const rawMode = record['breakMode']
    const breakMode = BREAK_MODES[typeof rawMode === 'string' ? rawMode : ''] ?? 'never'
    return {
      exceptionId: wireString(record['exceptionId'], 'exceptionInfo.exceptionId'),
      ...(typeof record['description'] === 'string' ? { description: record['description'] } : {}),
      breakMode,
      ...(isJsonObject(record['details']) ? { details: exceptionDetails(record['details']) } : {}),
    }
  }

  /**
   * Lists loaded modules; requires `supportsModulesRequest`.
   *
   * @param options Paging into the module list.
   * @returns The requested module slice and totals.
   */
  async modules(options?: DebugModulesOptions): Promise<DebugModulesPage> {
    this.requireCapability('supportsModulesRequest')
    const body = await this.request('modules', {
      ...(options?.startModule === undefined ? {} : { startModule: options.startModule }),
      ...(options?.moduleCount === undefined ? {} : { moduleCount: options.moduleCount }),
    })
    const record = isJsonObject(body) ? body : {}
    const list = Array.isArray(record['modules']) ? record['modules'] as readonly JsonValue[] : []
    const totalModules = wireNumber(record['totalModules'] === undefined ? list.length : record['totalModules'], 'modules.totalModules')
    const mapped = list.map((module) => {
      const entry = isJsonObject(module) ? module : {}
      return {
        id: typeof entry['id'] === 'number' ? entry['id'] : wireString(entry['id'], 'modules[].id'),
        name: wireString(entry['name'], 'modules[].name'),
        ...(typeof entry['path'] === 'string' ? { path: entry['path'] } : {}),
        ...(typeof entry['version'] === 'string' ? { version: entry['version'] } : {}),
      }
    })
    return { modules: mapped, totalModules, truncated: totalModules > mapped.length }
  }

  /**
   * Lists loaded sources; requires `supportsLoadedSourcesRequest`.
   *
   * @returns All loaded sources.
   */
  async loadedSources(): Promise<readonly DebugSource[]> {
    this.requireCapability('supportsLoadedSourcesRequest')
    const body = await this.request('loadedSources', {})
    const record = isJsonObject(body) ? body : {}
    const list = Array.isArray(record['sources']) ? record['sources'] as readonly JsonValue[] : []
    return list.map(source => wireSource(isJsonObject(source) ? source : {}, this.options.workspaceRoot))
  }

  /**
   * Fetches source content by reference.
   *
   * @param sourceReference Reference from a frame or breakpoint source.
   * @returns The source text and optional media type.
   */
  async source(sourceReference: DebugSourceReference): Promise<DebugSourceContent> {
    const body = await this.request('source', { sourceReference: wireId(sourceReference) })
    const record = isJsonObject(body) ? body : {}
    return {
      content: wireString(record['content'], 'source.content'),
      ...(typeof record['mimeType'] === 'string' ? { mimeType: record['mimeType'] } : {}),
    }
  }

  /**
   * Disassembles an instruction range; requires `supportsDisassembleRequest`.
   *
   * @param request Range to disassemble.
   * @returns The instruction page.
   */
  async disassemble(request: DebugDisassembleRequest): Promise<DebugDisassembly> {
    this.requireCapability('supportsDisassembleRequest')
    const body = await this.request('disassemble', {
      memoryReference: request.memoryReference,
      instructionCount: request.instructionCount,
      ...(request.instructionOffset === undefined ? {} : { instructionOffset: request.instructionOffset }),
      ...(request.offset === undefined ? {} : { offset: request.offset }),
      ...(request.resolveSymbols === undefined ? {} : { resolveSymbols: request.resolveSymbols }),
    })
    const record = isJsonObject(body) ? body : {}
    const list = Array.isArray(record['instructions']) ? record['instructions'] as readonly JsonValue[] : []
    const instructions = list.map((instruction) => {
      const entry = isJsonObject(instruction) ? instruction : {}
      return {
        address: wireString(entry['address'], 'disassemble[].address'),
        instruction: wireString(entry['instruction'], 'disassemble[].instruction'),
        ...(typeof entry['symbol'] === 'string' ? { symbol: entry['symbol'] } : {}),
        ...(isJsonObject(entry['location']) ? { location: wireSource(entry['location'], this.options.workspaceRoot) } : {}),
        ...(typeof entry['line'] === 'number' ? { line: entry['line'] } : {}),
        ...(typeof entry['column'] === 'number' ? { column: entry['column'] } : {}),
      }
    })
    return { instructions, truncated: false }
  }

  /**
   * Reads debuggee memory; requires `supportsReadMemoryRequest`.
   *
   * @param request Range to read.
   * @returns The decoded bytes; short when the adapter reads fewer.
   */
  async readMemory(request: { memoryReference: string; count: number; offset?: number }): Promise<Uint8Array> {
    this.requireCapability('supportsReadMemoryRequest')
    const body = await this.request('readMemory', {
      memoryReference: request.memoryReference,
      count: request.count,
      ...(request.offset === undefined ? {} : { offset: request.offset }),
    })
    const record = isJsonObject(body) ? body : {}
    const data = record['data']
    if (typeof data !== 'string') return new Uint8Array(0)
    return decodeBase64(data)
  }

  /**
   * Writes debuggee memory; requires `supportsWriteMemoryRequest`.
   *
   * @param request Range and base64 payload to write.
   */
  async writeMemory(request: DebugWriteMemoryRequest): Promise<void> {
    this.requireCapability('supportsWriteMemoryRequest')
    await this.request('writeMemory', {
      memoryReference: request.memoryReference,
      data: request.data,
      ...(request.offset === undefined ? {} : { offset: request.offset }),
    })
  }

  /**
   * Reads the bounded console ring without consuming it.
   *
   * @param options Cursor from a previous page and a page limit.
   * @returns One page and the cursor for the next read.
   */
  console(options?: DebugConsoleOptions): Promise<DebugConsolePage> {
    const limit = options?.limit === undefined ? this.options.consoleLimit : options.limit
    const start = options?.offset === undefined ? this.consoleBase : options.offset
    const index = Math.max(0, start - this.consoleBase)
    const slice = this.consoleRing.slice(index, index + limit)
    const truncated = index + limit < this.consoleRing.length
    return Promise.resolve({
      entries: slice,
      nextOffset: start + slice.length,
      truncated,
    })
  }

  private async resume(command: string, args: DapArguments, signal?: AbortSignal): Promise<DebugResumeResult> {
    this.requireNotTerminated()
    const waiter = this.registerResumeWaiter(signal)
    this.generation += 1
    this.eventEpoch += 1
    this.stopSnapshot = undefined
    await this.request(command, args)
    return waiter
  }

  private registerResumeWaiter(signal: AbortSignal | undefined): Promise<DebugResumeResult> {
    return new Promise<DebugResumeResult>((resolve) => {
      let settled = false
      const settle = (result: DebugResumeResult): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.resumeWaiter = undefined
        resolve(result)
      }
      const timer = setTimeout(() => { settle({ kind: 'running' }) }, this.options.resumeTimeoutMs)
      timer.unref()
      if (signal !== undefined) {
        const onAbort = () => { settle({ kind: 'running' }) }
        if (signal.aborted) onAbort()
        else signal.addEventListener('abort', onAbort, { once: true })
      }
      this.resumeWaiter = { resolve: settle }
    })
  }

  private handleEvent(message: DapEvent): void {
    if (message.event === 'output') {
      this.pushConsoleEntry(message)
      return
    }
    if (message.event === 'stopped') {
      this.handleStopped(message)
      return
    }
    if (message.event === 'continued') {
      this.stopSnapshot = undefined
      return
    }
    if (message.event === 'terminated' || message.event === 'exited') {
      this.terminated = true
      this.stopSnapshot = undefined
      this.resumeWaiter?.resolve({ kind: 'terminated' })
    }
  }

  private handleStopped(message: DapEvent): void {
    this.stopSettling = this.settleStop(message).catch(() => {
      // A malformed stopped event also fails the client's handshake wait; the
      // reader loop owns that death, this handler must not leak a rejection.
    })
  }

  private async settleStop(message: DapEvent): Promise<void> {
    const body = isJsonObject(message.body) ? message.body : {}
    const threadId = wireNumber(body['threadId'], 'stopped.threadId')
    const epoch = this.eventEpoch
    this.generation += 1
    const snapshot: DebugStopSnapshot = {
      sessionId: this.options.sessionId,
      reason: mapStopReason(body['reason']),
      threadId: DebugThreadId(String(threadId)),
      ...(typeof body['description'] === 'string' && body['description'] !== '' ? { description: body['description'] } : {}),
      ...(await this.snapshotSource(threadId)),
    }
    if (epoch !== this.eventEpoch) return
    this.stopSnapshot = snapshot
    this.resumeWaiter?.resolve({ kind: 'stopped', stop: snapshot })
  }

  private async snapshotSource(threadId: number): Promise<Pick<DebugStopSnapshot, 'source' | 'line' | 'column' | 'frameId'>> {
    try {
      const body = await this.request('stackTrace', { threadId })
      const frames = isJsonObject(body) && Array.isArray(body['stackFrames']) ? body['stackFrames'] as readonly JsonValue[] : []
      const [first] = frames
      if (first === undefined) return emptyStopPosition()
      const frame = this.registerFrame(first)
      return { frameId: frame.id, source: frame.source ?? { workspaceRelativePath: '', absolutePath: '' }, line: frame.line ?? 1, column: frame.column ?? 1 }
    } catch {
      return emptyStopPosition()
    }
  }

  private pushConsoleEntry(message: DapEvent): void {
    const body = isJsonObject(message.body) ? message.body : {}
    const rawCategory = body['category']
    const reference = body['variablesReference']
    this.consoleRing.push({
      category: CONSOLE_CATEGORIES[typeof rawCategory === 'string' ? rawCategory : ''] ?? 'console',
      output: typeof body['output'] === 'string' ? body['output'] : '',
      ...(typeof body['groupId'] === 'number' ? { groupId: body['groupId'] } : {}),
      ...(typeof reference === 'number' && reference !== 0 ? { variablesReference: DebugVariableReference(String(reference)) } : {}),
    })
    if (this.consoleRing.length > this.options.consoleLimit) {
      this.consoleRing.shift()
      this.consoleBase += 1
    }
  }

  private handleReverseRequest(request: DapRequest): Promise<DapArguments> {
    const handlers = this.options.reverseRequests
    if (request.command === 'runInTerminal' && handlers?.runInTerminal !== undefined) return handlers.runInTerminal(request)
    if (request.command === 'startDebugging' && handlers?.startDebugging !== undefined) return handlers.startDebugging(request)
    throw new Error(`unsupported reverse request: ${request.command}`)
  }

  private requireCapability(name: keyof DebugCapabilities): void {
    if (this.capabilities?.[name] === true) return
    throw new DebugError(`adapter did not declare ${name}`, 'DEBUG_UNSUPPORTED_CAPABILITY')
  }

  private requireStopped(): void {
    if (this.stopSnapshot !== undefined) return
    throw new DebugError('debug session is not stopped', 'DEBUG_NOT_STOPPED')
  }

  private requireNotTerminated(): void {
    if (!this.terminated) return
    throw new DebugError('debug session has terminated', 'DEBUG_INVALID_STATE')
  }

  private requireCurrentFrame(frameId: DebugFrameId): void {
    if (this.frameGenerations.get(wireId(frameId)) === this.generation) return
    throw new DebugError(`frame reference is stale: ${frameId}`, 'DEBUG_STALE_REFERENCE')
  }

  private requireCurrentVariables(reference: DebugVariableReference): void {
    if (this.variableGenerations.get(wireId(reference)) === this.generation) return
    throw new DebugError(`variable reference is stale: ${reference}`, 'DEBUG_STALE_REFERENCE')
  }

  private registerFrame(frame: JsonValue): DebugStackFrame {
    const record = isJsonObject(frame) ? frame : {}
    const id = wireNumber(record['id'], 'stackFrames[].id')
    this.frameGenerations.set(id, this.generation)
    return {
      id: DebugFrameId(String(id)),
      name: wireString(record['name'], 'stackFrames[].name'),
      ...(isJsonObject(record['source']) ? { source: wireSource(record['source'], this.options.workspaceRoot) } : {}),
      ...(typeof record['line'] === 'number' ? { line: record['line'] } : {}),
      ...(typeof record['column'] === 'number' ? { column: record['column'] } : {}),
    }
  }

  private registerVariable(variable: JsonValue): DebugVariable {
    const record = isJsonObject(variable) ? variable : {}
    const reference = wireNumber(record['variablesReference'] === undefined ? 0 : record['variablesReference'], 'variables[].variablesReference')
    this.variableGenerations.set(reference, this.generation)
    return {
      name: wireString(record['name'], 'variables[].name'),
      value: wireString(record['value'], 'variables[].value'),
      ...(typeof record['type'] === 'string' ? { type: record['type'] } : {}),
      variablesReference: DebugVariableReference(String(reference)),
    }
  }

  private async request(command: string, args: DapArguments): Promise<JsonValue | undefined> {
    const wireResponse = await this.client.request(command, args, AbortSignal.timeout(this.options.requestTimeoutMs))
    if (!wireResponse.success) {
      const detail = typeof wireResponse.message === 'string' ? wireResponse.message : 'no detail'
      throw new DebugError(`adapter rejected ${command}: ${detail}`, 'DEBUG_LAUNCH_FAILED')
    }
    return wireResponse.body
  }
}

function emptyStopPosition(): Pick<DebugStopSnapshot, 'source' | 'line' | 'column'> {
  return { source: { workspaceRelativePath: '', absolutePath: '' }, line: 1, column: 1 }
}

function toWireBreakpoint(input: DebugBreakpointInput): { readonly [key: string]: JsonValue } {
  return {
    line: input.line,
    ...(input.column === undefined ? {} : { column: input.column }),
    ...(input.condition === undefined ? {} : { condition: input.condition }),
    ...(input.hitCondition === undefined ? {} : { hitCondition: input.hitCondition }),
    ...(input.logMessage === undefined ? {} : { logMessage: input.logMessage }),
  }
}

interface WireBreakpoint {
  readonly id: number
  readonly verified: boolean
  readonly line?: number
  readonly message?: string
}

function wireBreakpoints(body: JsonValue | undefined): readonly WireBreakpoint[] {
  const list = isJsonObject(body) && Array.isArray(body['breakpoints']) ? body['breakpoints'] as readonly JsonValue[] : []
  return list.map((entry) => {
    const record = isJsonObject(entry) ? entry : {}
    return {
      id: wireNumber(record['id'], 'breakpoints[].id'),
      verified: record['verified'] === true,
      ...(typeof record['line'] === 'number' ? { line: record['line'] } : {}),
      ...(typeof record['message'] === 'string' ? { message: record['message'] } : {}),
    }
  })
}

function partitionBreakpoints(
  inputs: readonly DebugBreakpointInput[],
  verified: readonly WireBreakpoint[],
  source: DebugSource,
): DebugBreakpointResult {
  const applied: DebugBreakpoint[] = []
  const rejected: DebugBreakpoint[] = []
  inputs.forEach((input, index) => {
    const wire = verified[index]
    const base = {
      id: DebugBreakpointId(String(wire?.id ?? 0)),
      source,
      requestedLine: input.line,
      ...(wire?.line !== undefined ? { actualLine: wire.line } : {}),
      ...(wire?.message !== undefined ? { message: wire.message } : {}),
    }
    if (wire === undefined || !wire.verified) {
      rejected.push({ ...base, verified: false })
      return
    }
    applied.push({ ...base, verified: true })
  })
  return { applied, rejected }
}

function functionBreakpoint(wire: WireBreakpoint): DebugBreakpoint {
  return {
    id: DebugBreakpointId(String(wire.id)),
    source: { workspaceRelativePath: '', absolutePath: '' },
    requestedLine: 0,
    verified: wire.verified,
    ...(wire.line !== undefined ? { actualLine: wire.line } : {}),
    ...(wire.message !== undefined ? { message: wire.message } : {}),
  }
}

function wireSource(record: { readonly [key: string]: JsonValue }, workspaceRoot: string): DebugSource {
  const path = typeof record['path'] === 'string' ? record['path'] : ''
  const prefix = workspaceRoot === '' ? '' : workspaceRoot.endsWith('/') ? workspaceRoot : workspaceRoot + '/'
  return {
    workspaceRelativePath: path.startsWith(prefix) && prefix !== '' ? path.slice(prefix.length) : path,
    absolutePath: path,
    ...(typeof record['sourceReference'] === 'number' ? { sourceReference: DebugSourceReference(String(record['sourceReference'])) } : {}),
  }
}

function exceptionDetails(
  record: { readonly [key: string]: JsonValue },
): { message?: string; typeName?: string; fullTypeName?: string; evaluateName?: string; stack?: string } {
  return {
    ...(typeof record['message'] === 'string' ? { message: record['message'] } : {}),
    ...(typeof record['typeName'] === 'string' ? { typeName: record['typeName'] } : {}),
    ...(typeof record['fullTypeName'] === 'string' ? { fullTypeName: record['fullTypeName'] } : {}),
    ...(typeof record['evaluateName'] === 'string' ? { evaluateName: record['evaluateName'] } : {}),
    ...(typeof record['stack'] === 'string' ? { stack: record['stack'] } : {}),
  }
}

function wireId(id: DebugThreadId | DebugFrameId | DebugVariableReference | DebugSourceReference): number {
  return Number(id)
}

/** Optional condition fields every breakpoint wire form carries when present. */
function breakpointConditions(breakpoint: { readonly condition?: string; readonly hitCondition?: string }): {
  readonly condition?: string
  readonly hitCondition?: string
} {
  return {
    ...(breakpoint.condition === undefined ? {} : { condition: breakpoint.condition }),
    ...(breakpoint.hitCondition === undefined ? {} : { hitCondition: breakpoint.hitCondition }),
  }
}

function wireNumber(value: JsonValue | undefined, field: string): number {
  if (typeof value !== 'number') throw new DebugError(`wire field ${field} must be a number`, 'DEBUG_MALFORMED_RESPONSE')
  return value
}

function wireString(value: JsonValue | undefined, field: string): string {
  if (typeof value !== 'string') throw new DebugError(`wire field ${field} must be a string`, 'DEBUG_MALFORMED_RESPONSE')
  return value
}

function decodeBase64(data: string): Uint8Array {
  return Uint8Array.from(atob(data), character => character.charCodeAt(0))
}
