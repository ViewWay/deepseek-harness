/**
 * `ctx.debugAdapters`: the manifest registry and managed-install
 * orchestrator. Registers validated manifests, shares one in-flight install
 * per provider and platform, resolves installed adapters without ever falling
 * back to a host adapter for a remote world, and publishes install lifecycle
 * events after they commit.
 * @module @deepseek-ai/dsh-debug-adapter-manager/manager
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { DebugError } from '@deepseek-ai/dsh-debug'
import type { DebugProviderId as DebugProviderIdValue, ResolvedDebugAdapter } from '@deepseek-ai/dsh-debug'
import type { DebugAdapterInstallEnvironment, DebugAdapterInstallPath } from './install.ts'
import { adapterInstallPath, installAdapter } from './install.ts'
import type { DebugAdapterManifest, DebugAdapterPlatformKey } from './manifest.ts'
import { parseAdapterManifest, resolveAdapterPlatform } from './manifest.ts'

/** Install lifecycle event, published after the operation committed. */
export type DebugAdapterEvent =
  | { readonly kind: 'adapter/installed'; readonly providerId: DebugProviderIdValue; readonly platform: DebugAdapterPlatformKey }
  | { readonly kind: 'adapter/uninstalled'; readonly providerId: DebugProviderIdValue; readonly platform: DebugAdapterPlatformKey }
  | { readonly kind: 'adapter/install-failed'; readonly providerId: DebugProviderIdValue; readonly platform: DebugAdapterPlatformKey; readonly code: string }

/** Subscription face over adapter install lifecycle events. */
export interface DebugAdapterEventSource {
  /**
   * Subscribe to install lifecycle events.
   * @param listener - synchronous listener invoked after each committed change.
   * @returns the disposer removing this subscription.
   */
  subscribe(listener: (event: DebugAdapterEvent) => void): () => void
}

/** One adapter's registration and install state as `list` reports it. */
export interface DebugAdapterStatus {
  readonly providerId: DebugProviderIdValue
  readonly version: string
  readonly platforms: readonly DebugAdapterPlatformKey[]
}

/** One managed install invocation. */
export interface DebugAdapterInstallCall {
  readonly platform: DebugAdapterPlatformKey
  readonly installRoot: string
  readonly environment: DebugAdapterInstallEnvironment
}

/** One adapter resolution invocation. */
export interface DebugAdapterResolveCall {
  readonly platform: DebugAdapterPlatformKey
  readonly installRoot: string
  readonly environment: Pick<DebugAdapterInstallEnvironment, 'pathSeparator' | 'exists'>
}

/**
 * The adapter manager service. Manifest registrations commit through
 * `ctx.effect` so disposal releases them; installs share one in-flight
 * promise per provider and platform.
 */
export class DebugAdapterManager extends Service {
  private readonly manifests = new Map<DebugProviderIdValue, DebugAdapterManifest>()
  private readonly listeners = new Set<(event: DebugAdapterEvent) => void>()
  private readonly inFlightInstalls = new Map<string, Promise<DebugAdapterInstallPath>>()

  constructor(ctx: Context) {
    super(ctx, 'debugAdapters')
  }

  /** Install lifecycle events, published after each change commits. */
  get events(): DebugAdapterEventSource {
    return {
      subscribe: (listener: (event: DebugAdapterEvent) => void) => {
        this.listeners.add(listener)
        return () => {
          this.listeners.delete(listener)
        }
      },
    }
  }

  /**
   * Register one validated adapter manifest.
   * @param value - the raw manifest, as read from its data file.
   * @returns the disposer releasing the registration.
   * @throws {@link DebugError} `DEBUG_INVALID_CONFIG` or
   * `DEBUG_ADAPTER_CHECKSUM` from manifest validation;
   * `DEBUG_CONFLICT` when the provider already has a manifest.
   */
  registerManifest(value: unknown): () => void {
    const manifest = parseAdapterManifest(value)
    if (this.manifests.has(manifest.providerId)) {
      throw new DebugError(
        `an adapter manifest for "${manifest.providerId}" is already registered`,
        'DEBUG_CONFLICT',
        { providerId: manifest.providerId },
      )
    }
    const dispose = this.ctx.effect(() => {
      this.manifests.set(manifest.providerId, manifest)
      return () => {
        this.manifests.delete(manifest.providerId)
      }
    }, 'debugAdapters.registerManifest()')
    return () => void dispose()
  }

  /**
   * List registered manifests.
   * @returns one status per manifest, in registration order.
   */
  list(): readonly DebugAdapterStatus[] {
    return [...this.manifests.values()].map(manifest => ({
      providerId: manifest.providerId,
      version: manifest.version,
      platforms: Object.keys(manifest.platforms),
    }))
  }

  /**
   * Install one provider's adapter for one platform in the target world.
   * Concurrent calls for the same provider and platform share one operation.
   * @param providerId - the registered manifest's provider.
   * @param call - platform, install root, and target-world I/O.
   * @returns the committed install layout.
   * @throws {@link DebugError} `DEBUG_ADAPTER_NOT_FOUND` when no manifest is
   * registered; install failures carry `DEBUG_ADAPTER_CHECKSUM` or
   * `DEBUG_ADAPTER_UNSUPPORTED`.
   */
  async install(providerId: DebugProviderIdValue, call: DebugAdapterInstallCall): Promise<DebugAdapterInstallPath> {
    const manifest = this.requireManifest(providerId)
    const key = `${providerId}:${call.platform}`
    const existing = this.inFlightInstalls.get(key)
    if (existing !== undefined) return existing
    const operation = (async () => {
      try {
        const layout = await installAdapter({ manifest, ...call })
        this.publish({ kind: 'adapter/installed', providerId, platform: call.platform })
        return layout
      } catch (error: unknown) {
        this.publish({
          kind: 'adapter/install-failed',
          providerId,
          platform: call.platform,
          code: error instanceof DebugError ? error.code : 'DEBUG_ADAPTER_UNSUPPORTED',
        })
        throw error
      } finally {
        this.inFlightInstalls.delete(key)
      }
    })()
    this.inFlightInstalls.set(key, operation)
    return operation
  }

  /**
   * Remove one provider's installed adapter directory for one platform.
   * @param providerId - the registered manifest's provider.
   * @param call - platform, install root, and target-world I/O.
   */
  async uninstall(providerId: DebugProviderIdValue, call: DebugAdapterInstallCall): Promise<void> {
    const manifest = this.requireManifest(providerId)
    const layout = adapterInstallPath(manifest, call.platform, call.installRoot, call.environment)
    await call.environment.remove(layout.directory)
    this.publish({ kind: 'adapter/uninstalled', providerId, platform: call.platform })
  }

  /**
   * Resolve one installed adapter. Managed resolution never falls back to a
   * host adapter: an absent install in the target world fails.
   * @param providerId - the registered manifest's provider.
   * @param call - platform, install root, and target-world presence check.
   * @returns the resolved adapter command for the target world.
   * @throws {@link DebugError} `DEBUG_ADAPTER_NOT_FOUND` when no manifest is
   * registered or the platform has no install in the target world;
   * `DEBUG_ADAPTER_UNSUPPORTED` when the platform was never published.
   */
  async resolve(providerId: DebugProviderIdValue, call: DebugAdapterResolveCall): Promise<ResolvedDebugAdapter> {
    const manifest = this.requireManifest(providerId)
    resolveAdapterPlatform(manifest, call.platform)
    const layout = adapterInstallPath(manifest, call.platform, call.installRoot, call.environment)
    const executablePath = layout.executableFile
    if (!(await call.environment.exists(executablePath))) {
      throw new DebugError(
        `adapter "${providerId}" is not installed for ${call.platform}; install it first`,
        'DEBUG_ADAPTER_NOT_FOUND',
        { providerId, detail: `expected ${executablePath} in the target execution world` },
      )
    }
    return {
      command: [executablePath, ...manifest.command.slice(1)],
      args: [],
      env: manifest.environment ?? {},
      version: manifest.version,
      platform: call.platform,
      source: 'managed',
      executablePath,
    }
  }

  /** Read one registered manifest or fail with the typed not-found code. */
  private requireManifest(providerId: DebugProviderIdValue): DebugAdapterManifest {
    const manifest = this.manifests.get(providerId)
    if (manifest === undefined) {
      throw new DebugError(
        `no adapter manifest registered for "${providerId}"`,
        'DEBUG_ADAPTER_NOT_FOUND',
        { providerId },
      )
    }
    return manifest
  }

  /** Publish one committed lifecycle event, containing listener failures. */
  private publish(event: DebugAdapterEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // One subscriber's throw must not fail the committed operation that
        // publishes this event.
      }
    }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    debugAdapters: DebugAdapterManager
  }
}

export default DebugAdapterManager
