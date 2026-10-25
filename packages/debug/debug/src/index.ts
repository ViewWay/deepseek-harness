/**
 * Service Definition of the debug capability seam (`ctx.debug`): the
 * language-provider registry that reserves a branded id and an exclusive set
 * of file extensions atomically, the session registry with live events and
 * workspace-scoped ownership, and compound configurations — plus the seam's
 * exported vocabulary: branded ids, the frozen contracts in `./types.ts`, the
 * typed {@link DebugError} taxonomy, and the session state machine.
 *
 * Launch and attach stay `DEBUG_UNAVAILABLE` until the DAP backend lands;
 * durable `debug/*` events and the `debugSessions` projection follow it.
 * @module @deepseek-ai/dsh-debug
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { DebugProviderId, DebugSessionId } from './brand.ts'
import { DebugError } from './error.ts'
import { installDebugArchiveAdmission } from './archive-admission.ts'
import { createDebugSessionsProjection } from './projection.ts'
import type { DebugSessionsProjectionConfig } from './projection.ts'
import { DEFAULT_MAX_PROJECTED_SESSIONS, DEFAULT_MAX_PROJECTED_STOPS } from './projection.ts'
import type {
  DebugAttachRequest,
  DebugLaunchRequest,
  DebugProvider,
  DebugScope,
  DebugSessionInfo,
} from './types.ts'
import type { DebugEventSource } from './events.ts'
import { DebugSessionRegistry } from './registry.ts'
import { BreakpointRegistry, DEFAULT_MAX_BREAKPOINTS_PER_FILE, MemoryBreakpointStore } from './breakpoints.ts'
import { LiveDebugSession, debugSessionInfoOf } from './session.ts'
import type { DebugLiveSession, DebugSessionRecord } from './session.ts'

export {
  DebugBreakpointId,
  DebugCompoundId,
  DebugFrameId,
  DebugProviderId,
  DebugSessionId,
  DebugSourceReference,
  DebugThreadId,
  DebugVariableReference,
} from './brand.ts'
export { DebugError } from './error.ts'
export type { DebugErrorDetails } from './error.ts'
export type {
  DebugAdapterCommand,
  DebugAdapterDescriptor,
  DebugAttachPlan,
  DebugAttachRequest,
  DebugAttachTarget,
  DebugBreakMode,
  DebugBreakpoint,
  DebugBreakpointInput,
  DebugBreakpointResult,
  DebugBreakpointSetRequest,
  DebugCaller,
  DebugCapabilities,
  DebugCompletion,
  DebugCompoundInfo,
  DebugConsoleCategory,
  DebugConsoleEntry,
  DebugConsoleOptions,
  DebugConsolePage,
  DebugDataBreakpointInput,
  DebugDataBreakpointRequest,
  DebugDisassembleRequest,
  DebugDisassembledInstruction,
  DebugDisassembly,
  DebugEnvironment,
  DebugErrorCode,
  DebugEvaluateContext,
  DebugEvaluateResult,
  DebugExceptionBreakpointRequest,
  DebugExceptionDetails,
  DebugExceptionInfo,
  DebugExecutionCapability,
  DebugFunctionBreakpointInput,
  DebugFunctionBreakpointRequest,
  DebugInstructionBreakpointInput,
  DebugInstructionBreakpointRequest,
  DebugLaunchPlan,
  DebugLaunchRequest,
  DebugModule,
  DebugModulesOptions,
  DebugModulesPage,
  DebugOperationOptions,
  DebugProvider,
  DebugReadMemoryRequest,
  DebugResumeResult,
  DebugScope,
  DebugScopeInfo,
  DebugSessionInfo,
  DebugSessionState,
  DebugSource,
  DebugSourceContent,
  DebugStackFrame,
  DebugStackTrace,
  DebugStackTraceOptions,
  DebugStepKind,
  DebugSteppingGranularity,
  DebugStopSnapshot,
  DebugTargetPlan,
  DebugThread,
  DebugVariable,
  DebugVariablesOptions,
  DebugVariablesPage,
  DebugWriteMemoryRequest,
  JsonSchema,
  JsonValue,
  ResolvedDebugAdapter,
} from './types.ts'
export { advanceDebugState, debugTerminalOutcome } from './state.ts'
export { BreakpointRegistry, DEFAULT_MAX_BREAKPOINTS_PER_FILE, normalizeWorkspacePath } from './breakpoints.ts'
export type { BreakpointApplier, BreakpointRegistryOptions, BreakpointSessionApplication } from './breakpoints.ts'
export { MemoryBreakpointStore, StorageBreakpointStore, breakpointDomain } from './breakpoint-store.ts'
export type { BreakpointStore } from './breakpoint-store.ts'
export { attachDebugSession, launchDebugSession } from './launch.ts'
export type { AttachDependencies, DebugDurableAppend, LaunchBackend, LaunchDependencies, LaunchOutcome } from './launch.ts'
export type { DebugSessionOutcome, DebugStateEvent } from './state.ts'
export { DebugEventBus } from './events.ts'
export type { DebugEvent, DebugEventActor, DebugEventFilter, DebugEventSource } from './events.ts'
export { DebugSessionRegistry } from './registry.ts'
export type { DebugSessionScope } from './registry.ts'
export { LiveDebugSession, debugSessionInfoOf } from './session.ts'
export type { DebugLiveSession, DebugSessionRecord, DebugSessionTeardown } from './session.ts'
export { DebugCompound, DebugCompoundRegistry } from './compound.ts'
export type { DebugCompoundChild } from './compound.ts'
export type {
  DebugControlEvent,
  DebugMessageSource,
  DebugSessionEndedEvent,
  DebugSessionStartedEvent,
  DebugStoppedEvent,
} from './session-events.ts'
export {
  DEFAULT_MAX_PROJECTED_SESSIONS,
  DEFAULT_MAX_PROJECTED_STOPS,
  createDebugSessionsProjection,
  debugSessionsProjection,
} from './projection.ts'
export type {
  DebugProjectedSession,
  DebugProjectedStop,
  DebugSessionsProjectionConfig,
  DebugSessionsProjectionDefinition,
  DebugSessionsProjectionState,
  DebugStoppedReason,
} from './projection.ts'
export { installDebugArchiveAdmission } from './archive-admission.ts'
export { probeDebugEnvironment } from './environment.ts'
export type { DebugEnvironmentProbe } from './environment.ts'
export { expandDebugVariables, parseLaunchConfig } from './launch-config.ts'
export type {
  DebugCompoundConfiguration,
  DebugLaunchConfig,
  DebugLaunchConfigContext,
  DebugLaunchConfiguration,
} from './launch-config.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    debug: Debug
  }
}

/** A well-formed normalized extension: a dot followed by one or more non-dot, non-separator chars. */
const EXTENSION_PATTERN = /^\.[^./\\]+$/

/** Deployment configuration for the debug service. */
export interface DebugConfig {
  /** Newest sessions the `debugSessions` projection retains. */
  maxProjectedSessions?: number
  /** Stops the `debugSessions` projection retains per session. */
  maxProjectedStops?: number
  /** Breakpoints one file may hold before `setBreakpoints` rejects. */
  maxBreakpointsPerFile?: number
}

/**
 * Validate one retention bound: a positive safe integer.
 * @param value - the configured bound.
 * @param field - the Config field name, for the failure message.
 * @returns the validated bound.
 * @throws RangeError for zero, negative, fractional, or unsafe values.
 */
function resolveBound(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`debug config "${field}" must be a positive safe integer, got ${value}`)
  }
  return value
}

/**
 * Normalize one provider extension to a lowercase leading-dot key (`.TS` → `.ts`).
 * @param extension - the extension as the provider declared it.
 * @returns the normalized extension, before pattern validation.
 */
function normalizeExtension(extension: string): string {
  const lower = extension.toLowerCase()
  return lower.startsWith('.') ? lower : `.${lower}`
}

/**
 * `ctx.debug`. Owns the provider table with its extension routes, the
 * workspace-scoped session registry with live events, and the compound
 * registry. A provider registration's id reservation and extension
 * reservations commit in one lifecycle controller so disposal always releases
 * them together.
 */
export class Debug extends Service {
  static inject = ['sessionProjections']

  /** Deployment-tunable retention bounds for the `debugSessions` projection. */
  static Config: z<DebugConfig> = z.object({
    maxProjectedSessions: z.number().default(DEFAULT_MAX_PROJECTED_SESSIONS),
    maxProjectedStops: z.number().default(DEFAULT_MAX_PROJECTED_STOPS),
    maxBreakpointsPerFile: z.number().default(DEFAULT_MAX_BREAKPOINTS_PER_FILE),
  })

  private readonly providersById = new Map<DebugProviderId, DebugProvider>()
  private readonly extensionOwners = new Map<string, DebugProviderId>()
  private readonly liveSessions = new WeakMap<DebugSessionRecord, LiveDebugSession>()
  private readonly projectionConfig: DebugSessionsProjectionConfig

  /** The session registry backing `list`/`get` and the live event source. */
  readonly sessions: DebugSessionRegistry = new DebugSessionRegistry()

  /** Validated, persisted, and session-applied breakpoint sets. */
  readonly breakpoints: BreakpointRegistry

  private readonly sessionBackends = new Map<DebugSessionId, unknown>()

  /**
   * Register one live session's backend handle; controllers resolve it to
   * drive execution and inspection without touching DAP.
   * @param sessionId - the session the backend serves.
   * @param backend - the composition's backend handle.
   * @returns disposer removing the registration.
   */
  registerBackend<T>(sessionId: DebugSessionId, backend: T): () => void {
    this.sessionBackends.set(sessionId, backend)
    return () => {
      if (this.sessionBackends.get(sessionId) === backend) this.sessionBackends.delete(sessionId)
    }
  }

  /**
   * Resolve one session's registered backend handle.
   * @param sessionId - the session to resolve.
   * @returns the handle, or undefined when the session has none registered.
   */
  backendOf<T>(sessionId: DebugSessionId): T | undefined {
    return this.sessionBackends.get(sessionId) as T | undefined
  }

  constructor(ctx: Context, config: DebugConfig = {}) {
    super(ctx, 'debug')
    this.projectionConfig = {
      maxProjectedSessions: resolveBound(config.maxProjectedSessions ?? DEFAULT_MAX_PROJECTED_SESSIONS, 'maxProjectedSessions'),
      maxProjectedStops: resolveBound(config.maxProjectedStops ?? DEFAULT_MAX_PROJECTED_STOPS, 'maxProjectedStops'),
    }
    this.breakpoints = new BreakpointRegistry(new MemoryBreakpointStore(), {
      maxPerFile: resolveBound(config.maxBreakpointsPerFile ?? DEFAULT_MAX_BREAKPOINTS_PER_FILE, 'maxBreakpointsPerFile'),
      publish: (event) => {
        this.sessions.publish(event)
      },
    })
  }

  protected async [Service.init](): Promise<void> {
    await this.ctx.sessionProjections.register(createDebugSessionsProjection(this.projectionConfig))
    installDebugArchiveAdmission(this.ctx, this.sessions)
  }

  /** Live debug events, published only after the owning state committed. */
  get events(): DebugEventSource {
    return this.sessions.events
  }

  /**
   * List debug sessions as read-facing infos.
   * @param scope - workspace and owner narrowing; omit for every session.
   * @returns the matching infos in registration order.
   */
  list(scope?: DebugScope): readonly DebugSessionInfo[] {
    return this.sessions.list(scope).map(record => debugSessionInfoOf(record))
  }

  /**
   * Resolve one registered session to its stable live-session object.
   * @param id - the session's id.
   * @returns the live session, or undefined when the id is not registered.
   */
  get(id: DebugSessionId): DebugLiveSession | undefined {
    const record = this.sessions.get(id)
    if (record === undefined) return undefined
    const existing = this.liveSessions.get(record)
    if (existing !== undefined) return existing
    const session = new LiveDebugSession(record, this.sessions)
    this.liveSessions.set(record, session)
    return session
  }

  /**
   * Launch a debug session.
   * @param _request - the launch request; consumed once the DAP backend lands.
   * @returns a promise for the live session; rejects until the backend lands.
   * @throws {@link DebugError} `DEBUG_UNAVAILABLE` until the backend lands.
   */
  launch(_request: DebugLaunchRequest): Promise<DebugLiveSession> {
    return Promise.reject(new DebugError('debug launch is unavailable until the DAP backend lands', 'DEBUG_UNAVAILABLE'))
  }

  /**
   * Attach to a running target.
   * @param _request - the attach request; consumed once the DAP backend lands.
   * @returns a promise for the live session; rejects until the backend lands.
   * @throws {@link DebugError} `DEBUG_UNAVAILABLE` until the backend lands.
   */
  attach(_request: DebugAttachRequest): Promise<DebugLiveSession> {
    return Promise.reject(new DebugError('debug attach is unavailable until the DAP backend lands', 'DEBUG_UNAVAILABLE'))
  }

  /**
   * Register one language provider after validating it completely.
   * @param provider - the provider to register.
   * @returns the disposer releasing the id and every extension reservation together.
   * @throws {@link DebugError} `DEBUG_INVALID_PROVIDER` for an empty id, an empty
   * extension list, a malformed extension, or duplicate extensions;
   * `DEBUG_CONFLICT` when the id or any extension is already reserved.
   */
  registerProvider(provider: DebugProvider): () => void {
    // Validate and conflict-check everything BEFORE any mutation: an invalid or
    // conflicting registration must publish nothing.
    const id = provider.id
    if (id.trim() === '') {
      throw new DebugError('a debug provider id must be a non-empty string', 'DEBUG_INVALID_PROVIDER', { providerId: id })
    }
    if (provider.extensions.length === 0) {
      throw new DebugError(`debug provider "${id}" registers no file extensions`, 'DEBUG_INVALID_PROVIDER', { providerId: id })
    }

    // Normalize into this provider's extension set, catching intra-provider
    // duplicates (e.g. `.TS` and `.ts`) before checking cross-provider conflicts.
    const pending = new Set<string>()
    for (const rawExtension of provider.extensions) {
      const extension = normalizeExtension(rawExtension)
      if (!EXTENSION_PATTERN.test(extension)) {
        throw new DebugError(
          `debug provider "${id}" registers an invalid extension "${rawExtension}"`,
          'DEBUG_INVALID_PROVIDER',
          { providerId: id },
        )
      }
      if (pending.has(extension)) {
        throw new DebugError(
          `debug provider "${id}" registers extension "${extension}" more than once`,
          'DEBUG_INVALID_PROVIDER',
          { providerId: id },
        )
      }
      pending.add(extension)
    }

    if (this.providersById.has(id)) {
      throw new DebugError(`a debug provider with id "${id}" is already registered`, 'DEBUG_CONFLICT', { providerId: id })
    }
    for (const extension of pending) {
      const owner = this.extensionOwners.get(extension)
      if (owner !== undefined) {
        throw new DebugError(
          `extension "${extension}" is already handled by debug provider "${owner}"`,
          'DEBUG_CONFLICT',
          { providerId: id },
        )
      }
    }

    // All checks passed: reserve the id and every extension in one lifecycle
    // controller so disposal releases them together.
    const dispose = this.ctx.effect(function* (this: Debug) {
      this.providersById.set(id, provider)
      for (const extension of pending) this.extensionOwners.set(extension, id)
      yield () => {
        this.providersById.delete(id)
        for (const extension of pending) this.extensionOwners.delete(extension)
      }
    }.bind(this), 'debug.registerProvider()')
    // ctx.effect's disposer returns Promise<void>; the seam's disposer is
    // synchronous fire-and-forget — discard the (always-resolved) promise.
    return () => void dispose()
  }

  /**
   * Read one registered provider.
   * @param id - the provider's branded id.
   * @returns the provider, or undefined when the id is not registered.
   */
  provider(id: DebugProviderId): DebugProvider | undefined {
    return this.providersById.get(id)
  }

  /**
   * List every registered provider.
   * @returns the providers in registration order.
   */
  providers(): readonly DebugProvider[] {
    return [...this.providersById.values()]
  }
}

export default Debug
