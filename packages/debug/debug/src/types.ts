/**
 * Pure-type outlet of the debug seam: the frozen contracts from the IDE
 * debugging design (Shared Interfaces + design section 4, review-resolved
 * 2026-10-25). No runtime code lives here. Any drift is a contract change:
 * update the design and the implementation plan first, then this file.
 * @module @deepseek-ai/dsh-debug/types
 */

import type { SessionId } from '@deepseek-ai/dsh-session'
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

/** A resolved adapter ready to spawn: command, provenance, and identity. */
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
  readonly platform: NodeJS.Platform
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
