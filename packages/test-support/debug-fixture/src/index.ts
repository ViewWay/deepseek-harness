/**
 * Typed fixture factories for debug-seam tests. Tests construct every
 * `Debug*` value through these factories instead of casting with `as never`
 * or `as unknown`: a missing factory shape is a contract gap to fix first,
 * not a cast to add.
 *
 * Ids derive deterministically from a numeric seed: session ids follow the
 * seam's `debug-` + 16 lowercase hex digits format, so failures name stable,
 * well-formed ids.
 * @module @deepseek-ai/dsh-debug-fixture
 */

import { vi } from 'vitest'
import type { Mock } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { DebugCompoundId, DebugSessionId, DebugThreadId } from '@deepseek-ai/dsh-debug'
import type {
  DebugCompoundId as DebugCompoundIdValue,
  DebugEnvironment,
  DebugProviderId as DebugProviderIdValue,
  DebugSessionId as DebugSessionIdValue,
  DebugSessionState,
  DebugThreadId as DebugThreadIdValue,
  ResolvedDebugAdapter,
} from '@deepseek-ai/dsh-debug'
import { brandString } from '@deepseek-ai/dsh-brand'
import { FileSystem } from '@deepseek-ai/dsh-fs'
import { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import type { SessionHeader, SessionId } from '@deepseek-ai/dsh-session'

/**
 * Render one fixture seed as exactly 16 lowercase hex digits.
 * @param seed - non-negative safe integer identifying the fixture value.
 * @returns the zero-padded 16-digit lowercase hex form.
 * @throws RangeError when the seed is negative or not a safe integer.
 */
function fixtureHex(seed: number): string {
  if (!Number.isSafeInteger(seed) || seed < 0) {
    throw new RangeError(`fixture seed must be a non-negative safe integer, got ${seed}`)
  }
  return seed.toString(16).padStart(16, '0')
}

/**
 * Build one deterministic debug session id from a seed.
 * @param seed - non-negative safe integer identifying the session.
 * @returns a branded id in the `debug-` + 16 lowercase hex digits format.
 * @throws RangeError when the seed is negative or not a safe integer.
 */
export function fixtureDebugSessionId(seed: number): DebugSessionIdValue {
  return DebugSessionId(`debug-${fixtureHex(seed)}`)
}

/**
 * Build one deterministic harness session id from a seed.
 * @param seed - non-negative safe integer identifying the session.
 * @returns a branded `SessionId` in the `session-` + 16 lowercase hex digits format.
 * @throws RangeError when the seed is negative or not a safe integer.
 */
export function fixtureSessionId(seed: number): SessionId {
  return brandString<SessionId>(`session-${fixtureHex(seed)}`)
}

/**
 * Build one deterministic debug compound id from a seed.
 * @param seed - non-negative safe integer identifying the compound.
 * @returns a branded id in the `debug-compound-` + 16 lowercase hex digits format.
 * @throws RangeError when the seed is negative or not a safe integer.
 */
export function fixtureDebugCompoundId(seed: number): DebugCompoundIdValue {
  return DebugCompoundId(`debug-compound-${fixtureHex(seed)}`)
}

/**
 * Build one deterministic debug thread id from a seed.
 * @param seed - non-negative safe integer identifying the thread.
 * @returns a branded id in the `thread-` + 16 lowercase hex digits format.
 * @throws RangeError when the seed is negative or not a safe integer.
 */
export function fixtureThreadId(seed: number): DebugThreadIdValue {
  return DebugThreadId(`thread-${fixtureHex(seed)}`)
}

/**
 * Build one minimal valid session header for projection tests.
 * @param idText - the header's session id text.
 * @returns a header stamped with the current format version and no fork prefix.
 */
export function fixtureSessionHeader(idText: string): SessionHeader {
  return {
    version: SESSION_FORMAT_VERSION,
    id: brandString<SessionId>(idText),
    createdAt: 0,
    isSeeded: false,
  }
}

/** One compound child test double: identity, state, and an observable terminate. */
export interface FixtureCompoundChild {
  readonly id: DebugSessionIdValue
  readonly state: DebugSessionState
  terminate: Mock<() => Promise<void>>
}

/**
 * Build one compound-child double whose `terminate` is a resolving mock.
 * @param init - the child's id and state.
 * @returns the child double; assert on `terminate.mock.calls`.
 */
export function fixtureCompoundChild(init: { id: DebugSessionIdValue; state: DebugSessionState }): FixtureCompoundChild {
  return { id: init.id, state: init.state, terminate: vi.fn(async () => {}) }
}


/** One throwaway error for unused fixture service methods. */
function unused(): Error {
  return new Error('fixtureDebugEnvironment services are placeholders and must not be called')
}

/** Placeholder filesystem: satisfies the abstract contract, refuses every call. */
class FixtureFileSystem extends FileSystem {
  override resolve(): Promise<never> {
    throw unused()
  }

  override processPath(): string {
    throw unused()
  }

  override fileUrl(): string {
    throw unused()
  }

  override contains(): boolean {
    throw unused()
  }

  override stat(): Promise<never> {
    throw unused()
  }

  override lstat(): Promise<never> {
    throw unused()
  }

  override readText(): Promise<never> {
    throw unused()
  }

  override streamText(): Promise<never> {
    throw unused()
  }

  override readBytes(): Promise<never> {
    throw unused()
  }

  override readByteRange(): Promise<never> {
    throw unused()
  }

  override listDir(): Promise<never> {
    throw unused()
  }

  override writeText(): Promise<never> {
    throw unused()
  }

  override editText(): Promise<never> {
    throw unused()
  }
}

/** Placeholder subprocess runtime: satisfies the abstract contract, refuses every call. */
class FixtureSubprocessRuntime extends SubprocessRuntime {
  override resolveExecutable(): Promise<never> {
    throw unused()
  }

  override terminalEnvironment(): Promise<never> {
    throw unused()
  }

  override spawn(): never {
    throw unused()
  }

  override spawnTerminal(): Promise<never> {
    throw unused()
  }
}

/** One typed debug environment double with an observable adapter resolver. */
export interface FixtureDebugEnvironment extends DebugEnvironment {
  readonly adapters: {
    resolve: Mock<(providerId: DebugProviderIdValue) => Promise<ResolvedDebugAdapter>>
  }
}

/** Overrides for the fixture environment's facts and resolved adapter. */
export interface FixtureDebugEnvironmentInit {
  readonly workspaceRoot?: string
  readonly cwd?: string
  readonly platform?: NodeJS.Platform
  readonly arch?: string
  readonly pathSeparator?: '/' | '\\'
  readonly resolvedCommand?: readonly string[]
  readonly resolvedVersion?: string
}

/**
 * Build one typed `DebugEnvironment` double for provider-resolution tests.
 * The subprocess and fs services are placeholders that throw on any use;
 * providers resolve through `adapters.resolve`, which returns a managed
 * js-debug-shaped adapter by default.
 * @param init - optional fact and adapter overrides.
 * @returns the typed environment double.
 */
export function fixtureDebugEnvironment(init: FixtureDebugEnvironmentInit = {}): FixtureDebugEnvironment {
  const ctx = new Context()
  const resolved: ResolvedDebugAdapter = {
    command: init.resolvedCommand ?? ['node', 'js-debug/src/dapDebugServer.js'],
    args: [],
    env: {},
    version: init.resolvedVersion ?? '1.140.0',
    platform: 'any',
    source: 'managed',
    executablePath: '/adapters/node/js-debug/src/dapDebugServer.js',
  }
  return {
    workspaceRoot: init.workspaceRoot ?? '/ws',
    cwd: init.cwd ?? '/ws',
    platform: init.platform ?? 'linux',
    arch: init.arch ?? 'x64',
    pathSeparator: init.pathSeparator ?? '/',
    subprocess: new FixtureSubprocessRuntime(ctx),
    fs: new FixtureFileSystem(ctx),
    adapters: { resolve: vi.fn((_providerId: DebugProviderIdValue): Promise<ResolvedDebugAdapter> => Promise.resolve(resolved)) },
    requiredCapabilities: [],
  }
}
