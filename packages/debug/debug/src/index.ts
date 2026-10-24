/**
 * Service Definition of the debug capability seam (`ctx.debug`): the
 * language-provider registry that reserves a branded id and an exclusive set
 * of file extensions atomically, plus the seam's exported vocabulary —
 * branded ids, the frozen contracts in `./types.ts`, the typed
 * {@link DebugError} taxonomy, and the session state machine.
 *
 * Session lifecycle (list/get, launch/attach, compounds, live events, durable
 * events, and the `debugSessions` projection) mounts on this service in
 * later tasks of the IDE debugging plan; until then the service exposes
 * exactly the registry.
 * @module @deepseek-ai/dsh-debug
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { DebugProviderId } from './brand.ts'
import { DebugError } from './error.ts'
import type { DebugProvider } from './types.ts'

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
  DebugBreakpoint,
  DebugBreakpointInput,
  DebugBreakpointResult,
  DebugBreakpointSetRequest,
  DebugCaller,
  DebugCapabilities,
  DebugCompoundInfo,
  DebugEnvironment,
  DebugErrorCode,
  DebugExecutionCapability,
  DebugLaunchPlan,
  DebugLaunchRequest,
  DebugProvider,
  DebugResumeResult,
  DebugScopeInfo,
  DebugSessionInfo,
  DebugSessionState,
  DebugSource,
  DebugStackFrame,
  DebugStepKind,
  DebugStopSnapshot,
  DebugTargetPlan,
  DebugThread,
  DebugVariable,
  JsonSchema,
  JsonValue,
  ResolvedDebugAdapter,
} from './types.ts'
export { advanceDebugState, debugTerminalOutcome } from './state.ts'
export type { DebugSessionOutcome, DebugStateEvent } from './state.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    debug: Debug
  }
}

/** A well-formed normalized extension: a dot followed by one or more non-dot, non-separator chars. */
const EXTENSION_PATTERN = /^\.[^./\\]+$/

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
 * `ctx.debug`. Owns the provider table and the extension routes; a
 * registration's id reservation and extension reservations commit in one
 * lifecycle controller so disposal always releases them together.
 */
export class Debug extends Service {
  private readonly providersById = new Map<DebugProviderId, DebugProvider>()
  private readonly extensionOwners = new Map<string, DebugProviderId>()

  constructor(ctx: Context) {
    super(ctx, 'debug')
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
