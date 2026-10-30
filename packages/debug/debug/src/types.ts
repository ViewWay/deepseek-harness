/**
 * Pure-type outlet of the debug seam: the frozen contracts from the IDE
 * debugging design (Shared Interfaces + design section 4, review-resolved
 * 2026-10-25). No runtime code lives here. Any drift is a contract change:
 * update the design and the implementation plan first, then this file.
 * @module @deepseek-ai/dsh-debug/types
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import type {
  DebugBreakpointId,
  DebugCompoundId,
  DebugFrameId,
  DebugProviderId,
  DebugSessionId,
  DebugSourceReference,
  DebugThreadId,
  DebugVariableReference,
} from './brand.ts'

export type { DebugSessionId } from './brand.ts'

/** Lifecycle of one debug session; the state machine in `./state.ts` owns the legal transitions. */
export type DebugSessionState = 'starting' | 'running' | 'stopped' | 'terminated' | 'failed'

/** Step directions a stopped thread accepts. */
export type DebugStepKind = 'over' | 'in' | 'out' | 'back'

/** Settlement of `continue`/`step`: the next stop, a termination, or a still-running target. */
export type DebugResumeResult =
  | { kind: 'stopped'; stop: DebugStopSnapshot }
  | { kind: 'terminated' }
  | { kind: 'running' }

/**
 * Adapter capabilities this seam exposes. An undeclared capability reads as
 * `false` and its operations fail with `DEBUG_UNSUPPORTED_CAPABILITY`.
 */
export interface DebugCapabilities {
  readonly supportsConditionalBreakpoints: boolean
  readonly supportsHitConditionalBreakpoints: boolean
  readonly supportsLogPoints: boolean
  readonly supportsFunctionBreakpoints: boolean
  readonly supportsDataBreakpoints: boolean
  readonly supportsInstructionBreakpoints: boolean
  readonly supportsExceptionFilterOptions: boolean
  readonly supportsStepBack: boolean
  readonly supportsRestartFrame: boolean
  readonly supportsSetVariable: boolean
  readonly supportsSetExpression: boolean
  readonly supportsCompletionsRequest: boolean
  readonly supportsModulesRequest: boolean
  readonly supportsLoadedSourcesRequest: boolean
  readonly supportsBreakpointLocationsRequest: boolean
  readonly supportsDisassembleRequest: boolean
  readonly supportsReadMemoryRequest: boolean
  readonly supportsWriteMemoryRequest: boolean
  readonly supportsTerminateRequest: boolean
  readonly supportsRestartRequest: boolean
  readonly supportsDelayedStackTraceLoading: boolean
  readonly supportsValueFormattingOptions: boolean
  readonly supportsEvaluateForHovers: boolean
  readonly supportsExceptionInfoRequest: boolean
  readonly supportsCancelRequest: boolean
  readonly supportsANSIStyling: boolean
  readonly supportsProgressReporting: boolean
  readonly supportsRunInTerminalRequest: boolean
  readonly supportsStartDebuggingRequest: boolean
}

/** A JSON object member: string keys to JSON values (an interface so the recursive alias resolves). */
export interface JsonObject {
  readonly [key: string]: JsonValue
}

/** A JSON value as exchanged in DAP request payloads. */
export type JsonValue = null | string | number | boolean | readonly JsonValue[] | Readonly<JsonObject>

/** A JSON-Schema object describing a provider's `providerOptions`. */
export type JsonSchema = Readonly<JsonObject>

/** Execution-world capabilities a launch or attach plan may require before it may run. */
export type DebugExecutionCapability = 'ptrace' | 'processControl' | 'networkListen' | 'python' | 'go'

/**
 * Where a provider's adapter binary comes from: the managed adapter store, or
 * a fixed command override.
 */
export type DebugAdapterDescriptor =
  | { readonly kind: 'managed' }
  | { readonly kind: 'override'; readonly command: readonly string[] }

/**
 * One attachable target reported by `probeAttachTargets`, addressable by
 * process id, port, or URL.
 */
export interface DebugAttachTarget {
  /** Human-readable target label shown in pickers and tool results. */
  readonly name: string
  /** System process id, when the target is a running process. */
  readonly processId?: number
  /** TCP port, when the target listens for a debug connection. */
  readonly port?: number
  /** Host of `port`; defaults to the execution world's loopback. */
  readonly host?: string
  /** URL, when the target addresses itself by address instead of port. */
  readonly url?: string
}

/** A resolved adapter ready to spawn: command, origin, and identity. */
export interface ResolvedDebugAdapter {
  readonly command: readonly string[]
  readonly args: readonly string[]
  readonly env: Readonly<Record<string, string>>
  readonly version: string
  readonly platform: string
  readonly source: 'managed' | 'override'
  readonly executablePath: string
}

/** The command lines of one debug process: adapter or target, fully resolved. */
export interface DebugTargetPlan {
  readonly executable: string
  readonly args: readonly string[]
  readonly env: Readonly<Record<string, string>>
  readonly cwd: string
}

/**
 * The execution world a provider resolves against: workspace facts plus the
 * `subprocess` and `fs` services. Providers never spawn or read files
 * directly.
 */
export interface DebugEnvironment {
  readonly workspaceRoot: string
  readonly cwd: string
  readonly platform: string
  readonly arch: string
  readonly pathSeparator: '/' | '\\'
  readonly shell?: string
  readonly subprocess: SubprocessRuntime
  readonly fs: FileSystem
  readonly adapters: { resolve(providerId: DebugProviderId): Promise<ResolvedDebugAdapter> }
  readonly requiredCapabilities: readonly DebugExecutionCapability[]
}

/** Caller identity attached to every launch and attach; both kinds must carry the originating session. */
export type DebugCaller = { readonly kind: 'agent' | 'user'; readonly sessionId: SessionId }

/**
 * Per-operation options: cancellation and caller attribution. A request-level
 * `caller` wins for launch and attach; the option-level caller attributes
 * operations that carry no request of their own.
 */
export interface DebugOperationOptions {
  readonly signal?: AbortSignal
  readonly caller?: DebugCaller
}

/** Workspace narrowing for service reads; the service rejects cross-workspace requests. */
export interface DebugScope {
  readonly workspaceId: string
  readonly ownerSessionId?: SessionId
}

/**
 * A launch request before provider resolution; defaults are materialized in
 * `resolveLaunch`, never in `launch`.
 */
export interface DebugLaunchRequest {
  readonly providerId: DebugProviderId
  readonly workspaceRoot: string
  readonly workspaceId: string
  readonly cwd: string
  readonly program?: string
  readonly module?: string
  readonly args?: readonly string[]
  readonly env?: Readonly<Record<string, string>>
  readonly stopOnEntry?: boolean
  readonly configurationName?: string
  readonly breakpoints?: readonly DebugBreakpointInput[]
  readonly providerOptions?: Readonly<Record<string, unknown>>
  readonly caller: DebugCaller
}

/** An attach request before provider resolution. */
export interface DebugAttachRequest {
  readonly providerId: DebugProviderId
  readonly workspaceRoot: string
  readonly workspaceId: string
  readonly processId?: number
  readonly port?: number
  readonly host?: string
  readonly url?: string
  readonly providerOptions?: Readonly<Record<string, unknown>>
  readonly caller: DebugCaller
}

/**
 * The composition-level orchestration seam for launch and attach: resolves a
 * provider plan, spawns the adapter, performs the DAP handshake, and commits
 * the session into the registry. The domain stays DAP-free; a host plugin
 * installs the implementation, which returns the registered session id.
 */
export interface DebugLaunchOrchestrator {
  /**
   * Launch a debug session for the request's provider.
   * @param request - the validated launch request.
   * @returns the registered session's id.
   */
  launch(request: DebugLaunchRequest): Promise<DebugSessionId>
  /**
   * Attach to a running target for the request's provider.
   * @param request - the validated attach request.
   * @returns the registered session's id.
   */
  attach(request: DebugAttachRequest): Promise<DebugSessionId>
}

/** The adapter command lines shared by launch and attach plans. */
export interface DebugAdapterCommand {
  readonly command: readonly string[]
  readonly args: readonly string[]
  readonly env: Readonly<Record<string, string>>
  readonly cwd: string
}

/**
 * A fully resolved launch: adapter command, DAP `launch` arguments, target
 * process, and required execution capabilities.
 */
export interface DebugLaunchPlan {
  readonly adapter: DebugAdapterCommand
  readonly dapRequest: Readonly<Record<string, JsonValue>>
  readonly target: DebugTargetPlan
  readonly requires: readonly DebugExecutionCapability[]
  readonly manifestVersion: string
  readonly failureHint: string
}

/**
 * A fully resolved attach: adapter command, DAP `attach` arguments, optional
 * forwarding tunnel, and required execution capabilities.
 */
export interface DebugAttachPlan {
  readonly adapter: DebugAdapterCommand
  readonly dapRequest: Readonly<Record<string, JsonValue>>
  readonly tunnel?: { readonly host: string; readonly port: number }
  readonly requires: readonly DebugExecutionCapability[]
  readonly manifestVersion: string
  readonly failureHint: string
}

/**
 * One language provider on `ctx.debug`: identity, adapter source, and the
 * explicit resolve steps.
 */
export interface DebugProvider {
  readonly id: DebugProviderId
  readonly displayName: string
  readonly extensions: readonly string[]
  readonly adapter: DebugAdapterDescriptor
  readonly configSchema: JsonSchema
  resolveLaunch(request: DebugLaunchRequest, environment: DebugEnvironment): Promise<DebugLaunchPlan>
  resolveAttach(request: DebugAttachRequest, environment: DebugEnvironment): Promise<DebugAttachPlan>
  probeAttachTargets?(environment: DebugEnvironment, signal?: AbortSignal): Promise<readonly DebugAttachTarget[]>
}

/**
 * A source location: model-facing relative path, execution-world absolute
 * path, and optional adapter content reference.
 */
export interface DebugSource {
  readonly workspaceRelativePath: string
  readonly absolutePath: string
  readonly sourceReference?: DebugSourceReference
}

/** Step granularity the adapter applies; DAP's normalized set. */
export type DebugSteppingGranularity = 'statement' | 'instruction' | 'line'

/** Stack-trace paging: which frame slice to request. */
export interface DebugStackTraceOptions {
  /** Zero-based index of the first frame to return. */
  readonly startFrame?: number
  /** Maximum frame count to return. */
  readonly levels?: number
}

/** One stack-trace page: the requested frames plus whole-stack totals. */
export interface DebugStackTrace {
  readonly frames: readonly DebugStackFrame[]
  /** Total frames in the thread's stack, beyond any `levels` slice. */
  readonly totalFrames: number
  /** True when `levels` cut the returned slice short of `totalFrames`. */
  readonly truncated: boolean
}

/** Variable paging: which slice of one variable container to request. */
export interface DebugVariablesOptions {
  /** Zero-based index of the first child to return. */
  readonly start?: number
  /** Maximum child count to return. */
  readonly count?: number
  /** Restrict to indexed or named children; omit for both. */
  readonly filter?: 'indexed' | 'named'
}

/** One variables page: a single level of children plus container totals. */
export interface DebugVariablesPage {
  readonly variables: readonly DebugVariable[]
  /** Total children in the container, beyond any `count` slice. */
  readonly total: number
  /** True when `count` cut the returned slice short of `total`. */
  readonly truncated: boolean
}

/** Where an evaluation runs; DAP's complete context set. */
export type DebugEvaluateContext = 'watch' | 'repl' | 'hover' | 'clipboard' | 'variables'

/** One evaluation outcome: rendered value, optional type, and optional children. */
export interface DebugEvaluateResult {
  /** The rendered value string. */
  readonly result: string
  /** The adapter-reported type name. */
  readonly type?: string
  /** Children container; the no-children value when the result is a leaf. */
  readonly variablesReference: DebugVariableReference
  /** Adapter-assigned memory anchor for `readMemory`/`writeMemory`/`disassemble`. */
  readonly memoryReference?: string
}

/** One completion candidate, normalized from the DAP item. */
export interface DebugCompletion {
  readonly label: string
  /** Replacement text when it differs from the label. */
  readonly text?: string
  /** Zero-based replacement start offset. */
  readonly start?: number
  /** Replacement length. */
  readonly length?: number
}

/** Request to set exception breakpoints by adapter filter names. */
export interface DebugExceptionBreakpointRequest {
  /** Adapter-declared exception filter ids to activate. */
  readonly filters: readonly string[]
}

/** One function breakpoint as requested, before adapter verification. */
export interface DebugFunctionBreakpointInput {
  /** Function name to break on. */
  readonly name: string
  readonly condition?: string
  readonly hitCondition?: string
}

/** Request to replace the session's function breakpoints. */
export interface DebugFunctionBreakpointRequest {
  readonly breakpoints: readonly DebugFunctionBreakpointInput[]
}

/** One data breakpoint as requested, addressing a watchable data id. */
export interface DebugDataBreakpointInput {
  /** Data id from a variable's data breakpoint info. */
  readonly dataId: string
  /** Bytes to watch, when the adapter sizes watches. */
  readonly bytes?: number
  readonly condition?: string
  readonly hitCondition?: string
}

/** Request to replace the session's data breakpoints. */
export interface DebugDataBreakpointRequest {
  readonly breakpoints: readonly DebugDataBreakpointInput[]
}

/** One instruction breakpoint as requested, addressing disassembly output. */
export interface DebugInstructionBreakpointInput {
  /** Instruction address reference from a disassembly. */
  readonly instructionReference: string
  /** Negative or positive instruction offset from the reference. */
  readonly offset?: number
  readonly condition?: string
  readonly hitCondition?: string
}

/** Request to replace the session's instruction breakpoints. */
export interface DebugInstructionBreakpointRequest {
  readonly breakpoints: readonly DebugInstructionBreakpointInput[]
}

/** Exception detail lines; no nested inner exceptions cross this seam. */
export interface DebugExceptionDetails {
  /** The exception's message text. */
  readonly message?: string
  readonly typeName?: string
  readonly fullTypeName?: string
  /** Expression that re-evaluates the exception in a watch. */
  readonly evaluateName?: string
  /** Formatted stack excerpt. */
  readonly stack?: string
}

/** When the adapter breaks on exceptions; DAP's closed set. */
export type DebugBreakMode = 'never' | 'always' | 'unhandled' | 'userUnhandled' | 'all'

/** One stopped thread's exception, as `exceptionInfo` reports it. */
export interface DebugExceptionInfo {
  readonly exceptionId: string
  readonly description?: string
  readonly breakMode: DebugBreakMode
  readonly details?: DebugExceptionDetails
}

/** One loaded module of the debugged process. */
export interface DebugModule {
  /** Adapter-assigned module id; numeric or symbolic per adapter. */
  readonly id: number | string
  readonly name: string
  readonly path?: string
  readonly version?: string
}

/** Module paging: which module slice to request. */
export interface DebugModulesOptions {
  /** Zero-based index of the first module to return. */
  readonly startModule?: number
  /** Maximum module count to return. */
  readonly moduleCount?: number
}

/** One modules page plus whole-process totals. */
export interface DebugModulesPage {
  readonly modules: readonly DebugModule[]
  /** Total loaded modules, beyond any `moduleCount` slice. */
  readonly totalModules: number
  readonly truncated: boolean
}

/** Source content fetched by `sourceReference`. */
export interface DebugSourceContent {
  readonly content: string
  readonly mimeType?: string
}

/** Request to disassemble one instruction range. */
export interface DebugDisassembleRequest {
  readonly memoryReference: string
  readonly instructionCount: number
  /** Negative or positive first-instruction offset from the reference. */
  readonly instructionOffset?: number
  /** Byte offset from the reference. */
  readonly offset?: number
  /** Request symbol resolution when the adapter supports it. */
  readonly resolveSymbols?: boolean
}

/** One disassembled instruction with optional symbol and source location. */
export interface DebugDisassembledInstruction {
  readonly address: string
  readonly instruction: string
  readonly symbol?: string
  readonly location?: DebugSource
  readonly line?: number
  readonly column?: number
}

/** One disassembly page. */
export interface DebugDisassembly {
  readonly instructions: readonly DebugDisassembledInstruction[]
  readonly truncated: boolean
}

/** Request to read target-process memory. */
export interface DebugReadMemoryRequest {
  readonly memoryReference: string
  /** Byte count to read. */
  readonly count: number
  readonly offset?: number
}

/**
 * One memory read's outcome: the address the adapter resolved, the bytes it
 * read, and the unreadable tail. `data` shorter than the requested `count`
 * with no `unreadableBytes` marks the end of readable memory.
 */
export interface DebugReadMemoryResult {
  /** Address of the first returned byte, in the adapter's notation; absent when the adapter returned no body. */
  readonly address?: string
  /** Decoded bytes; empty when the adapter read none. */
  readonly data: Uint8Array
  /** Byte count after `data` the adapter could not read. */
  readonly unreadableBytes?: number
}

/** Request to write target-process memory; `data` is base64 (DAP semantics). */
export interface DebugWriteMemoryRequest {
  readonly memoryReference: string
  /** Base64-encoded bytes to write. */
  readonly data: string
  readonly offset?: number
  /** Accept a prefix write instead of an all-or-nothing failure. */
  readonly allowPartial?: boolean
}

/** One memory write's outcome; members appear only when the adapter reported them. */
export interface DebugWriteMemoryResult {
  /** Offset the adapter actually wrote at, when it reports one. */
  readonly offset?: number
  /** Bytes written; reported for partial writes the caller allowed. */
  readonly bytesWritten?: number
}

/** Console-output category; DAP's output-event set. */
export type DebugConsoleCategory = 'console' | 'important' | 'stdout' | 'stderr' | 'telemetry'

/** One bounded console entry in the session's non-consuming ring. */
export interface DebugConsoleEntry {
  readonly category: DebugConsoleCategory
  readonly output: string
  /** Adapter-assigned grouping id, when the entry opens a group. */
  readonly groupId?: number
  /** Children container for structured output, when the adapter provides one. */
  readonly variablesReference?: DebugVariableReference
}

/** Console paging by non-consuming offset cursor. */
export interface DebugConsoleOptions {
  /** Cursor from a previous page's `nextOffset`; omit to read from the oldest retained entry. */
  readonly offset?: number
  /** Maximum entry count to return. */
  readonly limit?: number
}

/** One console page plus the cursor for the next read. */
export interface DebugConsolePage {
  readonly entries: readonly DebugConsoleEntry[]
  readonly nextOffset: number
  readonly truncated: boolean
}

/** The complete fact of one stop, as surfaces and tools report it. */
export interface DebugStopSnapshot {
  readonly sessionId: DebugSessionId
  readonly reason:
    | 'breakpoint' | 'step' | 'pause' | 'entry' | 'exception'
    | 'dataBreakpoint' | 'instructionBreakpoint' | 'restart' | 'unknown'
  readonly threadId: DebugThreadId
  readonly frameId?: DebugFrameId
  readonly source: DebugSource
  readonly line: number
  readonly column: number
  readonly description?: string
}

/** One thread of a debugged process. */
export interface DebugThread {
  readonly id: DebugThreadId
  readonly name: string
}

/** One frame of a stopped thread's stack. */
export interface DebugStackFrame {
  readonly id: DebugFrameId
  readonly name: string
  readonly source?: DebugSource
  readonly line?: number
  readonly column?: number
}

/** One variable scope of a stack frame. */
export interface DebugScopeInfo {
  readonly name: string
  readonly variablesReference: DebugVariableReference
  readonly expensive: boolean
}

/**
 * One variable row; children open through a fresh `variables` call on
 * `variablesReference`, never recursively.
 */
export interface DebugVariable {
  readonly name: string
  readonly value: string
  readonly type?: string
  readonly variablesReference: DebugVariableReference
  /** Adapter-assigned memory anchor for `readMemory`/`writeMemory`/`disassemble`. */
  readonly memoryReference?: string
}

/**
 * The session-scoped operation surface one registered debug backend serves:
 * execution control, inspection, and the bounded reads the tool face and the
 * debug controller expose. `DapDebugBackend` satisfies this structurally; the
 * tool dispatch, the controller remotes, and tests consume it as the one
 * shared contract instead of per-layer method subsets.
 */
export interface DebugSessionOperations {
  /**
   * Resume a stopped thread.
   * @param threadId - the thread to resume; the stopped thread when omitted.
   * @param options - execution options the adapter accepts.
   * @returns the settlement: the next stop, termination, or still running.
   */
  continue(threadId?: DebugThreadId, options?: DebugOperationOptions): Promise<DebugResumeResult>
  /**
   * Step a stopped thread in one direction.
   * @param kind - the step direction; `back` requires `supportsStepBack`.
   * @param threadId - the thread to step; the stopped thread when omitted.
   * @param granularity - statement or instruction stepping when supported.
   * @returns the settlement of the step.
   */
  step(kind: DebugStepKind, threadId?: DebugThreadId, granularity?: DebugSteppingGranularity): Promise<DebugResumeResult>
  /**
   * Pause a running thread.
   * @param threadId - the thread to pause; the current thread when omitted.
   */
  pause(threadId?: DebugThreadId): Promise<void>
  /**
   * Re-run the current frame from its start; requires `supportsRestartFrame`.
   * @param frameId - the frame to restart; the top frame of the stopped thread.
   */
  restartFrame(frameId: DebugFrameId): Promise<void>
  /** Restart the debuggee from the program start; requires `supportsRestartRequest`. */
  restart(): Promise<void>
  /** @returns every debuggee thread with its stop state. */
  threads(): Promise<readonly DebugThread[]>
  /**
   * The stack of the currently stopped thread.
   * @returns the top stack page of the stopped thread.
   */
  currentThreadStack(): Promise<DebugStackTrace>
  /**
   * One thread's stack page.
   * @param threadId - the thread whose stack to read.
   * @param options - frame paging for long stacks.
   * @returns the requested stack page.
   */
  stackTrace(threadId: DebugThreadId, options?: DebugStackTraceOptions): Promise<DebugStackTrace>
  /**
   * The scope list of one frame.
   * @param frameId - the frame whose scopes to read.
   * @returns the frame's scopes in adapter order.
   */
  scopes(frameId: DebugFrameId): Promise<readonly DebugScopeInfo[]>
  /**
   * One page of a container's child variables.
   * @param reference - the `variablesReference` to expand.
   * @param options - paging and named/indexed filtering.
   * @returns the requested child page plus totals.
   */
  variables(reference: DebugVariableReference, options?: DebugVariablesOptions): Promise<DebugVariablesPage>
  /**
   * Evaluate one expression in a stopped frame.
   * @param expression - the expression text.
   * @param context - where the evaluation runs; DAP's complete context set.
   * @param frameId - the frame context; the stopped frame when omitted.
   * @returns the rendered result and its child or memory anchors.
   */
  evaluate(expression: string, context: DebugEvaluateContext, frameId?: DebugFrameId): Promise<DebugEvaluateResult>
  /**
   * Assign a value to one variable; requires `supportsSetVariable`.
   * @param reference - the container holding the variable.
   * @param name - the variable name within the container.
   * @param value - the assignment source text.
   * @returns the variable as the adapter re-rendered it.
   */
  setVariable(reference: DebugVariableReference, name: string, value: string): Promise<DebugVariable>
  /**
   * Assign a value to one expression; requires `supportsSetExpression`.
   * @param expression - the assignable expression text.
   * @param value - the assignment source text.
   * @param frameId - the frame context; the stopped frame when omitted.
   * @returns the re-evaluated expression result.
   */
  setExpression(expression: string, value: string, frameId?: DebugFrameId): Promise<DebugEvaluateResult>
  /**
   * Completion candidates for a REPL line; requires `supportsCompletionsRequest`.
   * @param text - the whole REPL line up to the cursor.
   * @param column - the zero-based cursor column within `text`.
   * @param frameId - the frame context; the stopped frame when omitted.
   * @returns the normalized candidates.
   */
  completions(text: string, column: number, frameId?: DebugFrameId): Promise<readonly DebugCompletion[]>
  /**
   * The exception of a stopped thread.
   * @param threadId - the thread stopped on an exception.
   * @returns the adapter's exception report.
   */
  exceptionInfo(threadId: DebugThreadId): Promise<DebugExceptionInfo>
  /**
   * One page of loaded modules; requires `supportsModulesRequest`.
   * @param options - module paging.
   * @returns the requested module page plus totals.
   */
  modules(options?: DebugModulesOptions): Promise<DebugModulesPage>
  /** @returns every source the adapter reports as loaded. */
  loadedSources(): Promise<readonly DebugSource[]>
  /**
   * Fetch one dynamic source's content.
   * @param sourceReference - the reference the stack or modules reported.
   * @returns the source text.
   */
  source(sourceReference: DebugSourceReference): Promise<DebugSourceContent>
  /**
   * Possible breakpoint positions of one source range; requires `supportsBreakpointLocationsRequest`.
   * @param request - the source and line range to resolve.
   * @returns the adapter-resolved positions, in adapter order.
   */
  breakpointLocations(request: DebugBreakpointLocationsRequest): Promise<readonly DebugBreakpointLocation[]>
  /**
   * Disassemble one instruction range; requires `supportsDisassembleRequest`.
   * @param request - the memory anchor, range, and symbol resolution flags.
   * @returns the disassembled instructions.
   */
  disassemble(request: DebugDisassembleRequest): Promise<DebugDisassembly>
  /**
   * Read debuggee memory; requires `supportsReadMemoryRequest`.
   * @param request - the memory anchor, byte count, and optional offset.
   * @returns the resolved address, the bytes actually read, and any unreadable
   * tail; a response without a body maps to empty data and no address.
   */
  readMemory(request: DebugReadMemoryRequest): Promise<DebugReadMemoryResult>
  /**
   * Write debuggee memory; requires `supportsWriteMemoryRequest`.
   * @param request - the memory anchor, bytes, optional offset, and whether a
   * partial write may settle instead of failing.
   * @returns the adapter's write report; `offset` and `bytesWritten` when the
   * adapter reported them.
   */
  writeMemory(request: DebugWriteMemoryRequest): Promise<DebugWriteMemoryResult>
  /**
   * One page of console output records.
   * @param options - cursor paging over the console history.
   * @returns the requested console page plus the next cursor.
   */
  console(options?: DebugConsoleOptions): Promise<DebugConsolePage>
}

/** One position an adapter resolves as a legal breakpoint within a source range. */
export interface DebugBreakpointLocation {
  /** One-based line of the position. */
  readonly line: number
  /** One-based column in UTF-16 code units, when the adapter resolves columns. */
  readonly column?: number
  /** End line of a multi-line position. */
  readonly endLine?: number
  /** End column in UTF-16 code units of a multi-line position. */
  readonly endColumn?: number
}

/** Request for the legal breakpoint positions of one source range. */
export interface DebugBreakpointLocationsRequest {
  /** The source whose positions to resolve. */
  readonly source: DebugSource
  /** One-based start line of the range. */
  readonly line: number
  /** One-based start column in UTF-16 code units, when the range starts mid-line. */
  readonly column?: number
  /** End line of the range; the single `line` when omitted. */
  readonly endLine?: number
  /** End column in UTF-16 code units of the range's last line. */
  readonly endColumn?: number
}

/** A breakpoint as requested, before adapter verification. */
export interface DebugBreakpointInput {
  readonly line: number
  readonly column?: number
  readonly condition?: string
  readonly hitCondition?: string
  readonly logMessage?: string
}

/** A set-breakpoints request against one source. */
export interface DebugBreakpointSetRequest {
  readonly source: DebugSource
  readonly breakpoints: readonly DebugBreakpointInput[]
}

/**
 * A breakpoint as the adapter resolved it; `verified` false moves it to the
 * rejected side of a `DebugBreakpointResult`.
 */
export interface DebugBreakpoint {
  readonly id: DebugBreakpointId
  readonly source: DebugSource
  readonly requestedLine: number
  readonly verified: boolean
  readonly actualLine?: number
  readonly message?: string
}

/** Adapter-verified and adapter-rejected sides of one set-breakpoints call. */
export interface DebugBreakpointResult {
  readonly applied: readonly DebugBreakpoint[]
  readonly rejected: readonly DebugBreakpoint[]
}

/** Read-facing summary of one debug session. */
export interface DebugSessionInfo {
  readonly id: DebugSessionId
  readonly providerId: DebugProviderId
  readonly workspaceId: string
  readonly state: DebugSessionState
  readonly ownerSessionId?: SessionId
}

/** Read-facing summary of one compound configuration. */
export interface DebugCompoundInfo {
  readonly id: DebugCompoundId
  readonly sessions: readonly DebugSessionId[]
  readonly state: DebugSessionState
}

/**
 * Stable machine-routable failure codes of the debug seam; callers branch on
 * `code`, never on `message`.
 */
export type DebugErrorCode =
  | 'DEBUG_INVALID_PROVIDER' | 'DEBUG_CONFLICT' | 'DEBUG_UNAVAILABLE'
  | 'DEBUG_ADAPTER_NOT_FOUND' | 'DEBUG_ADAPTER_UNSUPPORTED' | 'DEBUG_ADAPTER_CHECKSUM'
  | 'DEBUG_LAUNCH_FAILED' | 'DEBUG_NOT_STOPPED' | 'DEBUG_INVALID_STATE'
  | 'DEBUG_STALE_REFERENCE' | 'DEBUG_UNSUPPORTED_CAPABILITY' | 'DEBUG_TIMEOUT'
  | 'DEBUG_MALFORMED_RESPONSE' | 'DEBUG_SANDBOX_DENIED' | 'DEBUG_ATTACH_UNSUPPORTED'
  | 'DEBUG_SESSION_GONE' | 'DEBUG_WORKSPACE_MISMATCH' | 'DEBUG_APPROVAL_DENIED'
  | 'DEBUG_CONTROL_NOT_GRANTED' | 'DEBUG_INVALID_CONFIG' | 'DEBUG_BREAKPOINT_LIMIT'
  | 'DEBUG_UNKNOWN_OPERATION'

// Task 7 seam additions that cross the Remote boundary (see breakpoints.ts).
export type { BreakpointSessionApplication } from './breakpoints.ts'
