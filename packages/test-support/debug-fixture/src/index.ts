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

import { PassThrough } from 'node:stream'
import { vi } from 'vitest'
import type { Mock } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { DebugBreakpointId, DebugCompoundId, DebugSessionId, DebugThreadId } from '@deepseek-ai/dsh-debug'
import type {
  DebugBreakpointId as DebugBreakpointIdValue,
  DebugBreakpointResult,
  JsonSchema,
  JsonValue,
  DebugCompoundId as DebugCompoundIdValue,
  DebugEnvironment,
  DebugProviderId as DebugProviderIdValue,
  DebugSessionId as DebugSessionIdValue,
  DebugSessionState,
  DebugThreadId as DebugThreadIdValue,
  ResolvedDebugAdapter,
} from '@deepseek-ai/dsh-debug'
import { brandString } from '@deepseek-ai/dsh-brand'
import { FileSystem, FsVersion } from '@deepseek-ai/dsh-fs'
import type { FsVersion as FsVersionValue } from '@deepseek-ai/dsh-fs'
import { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
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
 * Build one deterministic debug breakpoint id from a seed.
 * @param seed - non-negative safe integer identifying the breakpoint.
 * @returns a branded id in the `bp-` + 16 lowercase hex digits format.
 * @throws RangeError when the seed is negative or not a safe integer.
 */
export function fixtureDebugBreakpointId(seed: number): DebugBreakpointIdValue {
  return DebugBreakpointId(`bp-${fixtureHex(seed)}`)
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


/** Overrides for the launch-plan fixture. */
export interface FixtureLaunchPlanInit {
  readonly command?: readonly string[]
  readonly dapRequest?: Readonly<Record<string, JsonValue>>
}

/** Default shape of {@link fixtureLaunchPlan}. */
export interface FixtureLaunchPlan {
  readonly adapter: {
    readonly command: readonly string[]
    readonly args: readonly string[]
    readonly env: Readonly<Record<string, string>>
    readonly cwd: string
  }
  readonly dapRequest: Readonly<Record<string, JsonValue>>
  readonly target: {
    readonly executable: string
    readonly args: readonly string[]
    readonly env: Readonly<Record<string, string>>
    readonly cwd: string
  }
  readonly requires: readonly []
  readonly manifestVersion: string
  readonly failureHint: string
}

/**
 * Build one resolved launch plan double.
 * @param init - adapter command and DAP request overrides.
 * @returns The typed plan double.
 */
export function fixtureLaunchPlan(init: FixtureLaunchPlanInit = {}): FixtureLaunchPlan {
  return {
    adapter: { command: init.command ?? ['adapter'], args: [], env: {}, cwd: '/ws' },
    dapRequest: init.dapRequest ?? {},
    target: { executable: '/ws/src/a.ts', args: [], env: {}, cwd: '/ws' },
    requires: [],
    manifestVersion: 'fixture-1',
    failureHint: 'fixture hint',
  }
}

/** A launch-orchestration backend double: start, setBreakpoints, dispose. */
export interface FixtureBackend {
  readonly start: Mock<
    (options: { launch: Readonly<Record<string, JsonValue>>; timeoutMs: number }) =>
    Promise<{ terminated: boolean; stop?: { reason: string; threadId: string; source: string; line: number } }>
  >
  readonly setBreakpoints: Mock<
    (request: { source: string; breakpoints: readonly unknown[] }) =>
    Promise<DebugBreakpointResult>
  >
  readonly dispose: Mock<() => Promise<void>>
}

/**
 * Build one orchestration backend double.
 * @param init - start-result overrides.
 * @returns The backend double with observable methods.
 */
export function fixtureBackend(init: { terminated?: boolean } = {}): FixtureBackend {
  return {
    start: vi.fn(async (_options: { launch: Readonly<Record<string, JsonValue>>; timeoutMs: number }) => init.terminated === true
      ? { terminated: true }
      : { terminated: false, stop: { reason: 'breakpoint', threadId: '1', source: 'src/a.ts', line: 4 } }),
    setBreakpoints: vi.fn(async () => ({ applied: [], rejected: [] })),
    dispose: vi.fn(async () => {}),
  }
}

/**
 * Build one provider double whose resolve steps are observable mocks.
 * @param id - provider id text.
 * @param resolveLaunch - the plan the provider resolves.
 * @returns The typed provider double.
 */
export function fixtureProvider(id: string, resolveLaunch: () => Promise<FixtureLaunchPlan>): {
  id: DebugProviderIdValue
  displayName: string
  extensions: readonly string[]
  adapter: { kind: 'managed' }
  configSchema: JsonSchema
  resolveLaunch: Mock<() => Promise<FixtureLaunchPlan>>
  resolveAttach: Mock<() => Promise<never>>
} {
  return {
    id: brandString<DebugProviderIdValue>(id),
    displayName: id,
    extensions: ['.ts'],
    adapter: { kind: 'managed' },
    configSchema: { type: 'object' },
    resolveLaunch: vi.fn(resolveLaunch),
    resolveAttach: vi.fn(async () => {
      throw new Error('fixture provider cannot attach')
    }),
  }
}

/** A subprocess double that records spawn specs and yields pipe stdio. */
export class FakeLaunchSubprocessRuntime extends SubprocessRuntime {
  /** Every spawn spec, in call order. */
  readonly spawns: { argv: readonly string[]; cwd: string }[] = []

  constructor() {
    super(new Context())
  }

  override resolveExecutable(): Promise<never> {
    throw new Error('fake launch subprocess cannot resolve executables')
  }

  override terminalEnvironment(): Promise<never> {
    throw new Error('fake launch subprocess has no terminal environment')
  }

  override spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    this.spawns.push({ argv: spec.argv, cwd: spec.cwd })
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    return {
      stdin,
      stdout,
      stderr: new PassThrough(),
      control: undefined,
      collected: {},
      done: Promise.resolve({ exitCode: 0, signal: null }),
      terminate: () => {},
      waitForExit: async () => true,
    }
  }

  override spawnTerminal(): Promise<never> {
    throw new Error('fake launch subprocess cannot spawn terminals')
  }
}

/**
 * Build one environment double whose subprocess records adapter spawns.
 * @param init - fact and adapter-resolution overrides.
 * @returns The environment double with the recording subprocess.
 */
export function fixtureLaunchEnvironment(
  init: FixtureDebugEnvironmentInit = {},
): FixtureDebugEnvironment & { subprocess: FakeLaunchSubprocessRuntime } {
  const base = fixtureDebugEnvironment(init)
  return { ...base, subprocess: new FakeLaunchSubprocessRuntime() }
}


/**
 * Brand one fixture file version for editor-save guard tests.
 * @param text - the opaque version text.
 * @returns the branded version value.
 */
export function fixtureFsVersion(text: string): FsVersionValue {
  return FsVersion(text)
}

/**
 * Build one resolved attach plan double.
 * @param init - adapter command and DAP request overrides.
 * @returns The typed attach plan double.
 */
export function fixtureAttachPlan(init: FixtureLaunchPlanInit = {}): FixtureLaunchPlan {
  return fixtureLaunchPlan(init)
}
