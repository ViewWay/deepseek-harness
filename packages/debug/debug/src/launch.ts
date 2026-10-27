/**
 * Launch and attach orchestration: provider plan, adapter spawn, injected
 * backend, session registration, and durable `debug/*` event writes.
 *
 * The backend factory is injected: this module never imports the DAP client
 * package (it peer-depends on this one), so compositions wire the real
 * `DapDebugBackend` while tests wire doubles. Durable events carry
 * `ignorable: true` and never include variable values, memory, environment
 * values, or DAP frames.
 * @module @deepseek-ai/dsh-debug/launch
 */
import { DebugError } from './error.ts'
import { DebugSessionId } from './brand.ts'
import type { DebugAttachRequest, DebugBreakpointResult, DebugEnvironment, DebugLaunchRequest, DebugProvider, JsonValue } from './types.ts'
import type { DebugSessionRegistry } from './registry.ts'
import type { DebugSessionRecord } from './session.ts'
import type { BreakpointRegistry } from './breakpoints.ts'

/** Minimal readable byte stream face the backend factory receives. */
interface StreamReadable {
  readonly readable: boolean
}

/** Minimal writable byte stream face the backend factory receives. */
interface StreamWritable {
  readonly writable: boolean
}

/** Generate a debug session id suffix; predictability is fine (authorization rides workspace boundaries, not secrecy). */
function sessionHex(): string {
  let hex = ''
  for (let index = 0; index < 16; index += 1) hex += (Math.floor(Math.random() * 16)).toString(16)
  return hex
}

/** The backend slice orchestration drives; compositions inject the DAP one. */
export interface LaunchBackend {
  /** Runs the handshake to the first stop or termination. */
  start(options: { readonly launch: Readonly<Record<string, JsonValue>>; readonly timeoutMs: number }): Promise<LaunchOutcome>
  /** Applies one file's breakpoints to the session's adapter. */
  setBreakpoints(
    request: { readonly source: string; readonly breakpoints: readonly { readonly line: number }[] },
  ): Promise<DebugBreakpointResult>
  /** Tears the adapter connection down on failure or teardown. */
  dispose(): Promise<void>
}

/** What `LaunchBackend.start` settled on. */
export interface LaunchOutcome {
  /** Whether the target terminated before any stop. */
  readonly terminated: boolean
  /** The first stop's durable facts, when one happened. */
  readonly stop?: { readonly reason: string; readonly threadId: string; readonly source: string; readonly line: number }
}

/** Durable-event writer the orchestration commits through. */
export type DebugDurableAppend = (
  type: 'debug/session-started' | 'debug/stopped' | 'debug/session-ended',
  payload: Readonly<Record<string, JsonValue>>,
  options: { readonly ignorable: true },
) => void

/** Injected dependencies of one launch. */
export interface LaunchDependencies {
  readonly request: DebugLaunchRequest
  readonly provider: DebugProvider
  readonly environment: DebugEnvironment
  readonly registry: DebugSessionRegistry
  readonly append: DebugDurableAppend
  /** Builds the session backend over the spawned adapter's stdio. */
  readonly createBackend: (stdio: { readonly stdin: StreamWritable; readonly stdout: StreamReadable }) => Promise<LaunchBackend>
  /** Breakpoint registry to bind the session into; optional in tests. */
  readonly breakpoints?: BreakpointRegistry
  /** Handshake timeout in milliseconds; defaults to 30 seconds. */
  readonly requestTimeoutMs?: number
}

/** Injected dependencies of one attach. */
export interface AttachDependencies extends Omit<LaunchDependencies, 'request'> {
  readonly request: DebugAttachRequest
}

type LaunchPlan = Awaited<ReturnType<DebugProvider['resolveLaunch']>>
type AttachPlan = Awaited<ReturnType<DebugProvider['resolveAttach']>>
type AnyPlan = LaunchPlan | AttachPlan

interface OrchestrationBase extends Omit<LaunchDependencies, 'request' | 'provider'> {
  readonly provider: DebugProvider
  readonly workspaceId: string
  readonly callerSessionId: DebugLaunchRequest['caller']['sessionId']
  readonly resolvePlan: () => Promise<AnyPlan>
}

function allocateSessionId(): DebugSessionId {
  return DebugSessionId('debug-' + sessionHex())
}

function spawnAdapter(
  base: OrchestrationBase,
  plan: AnyPlan,
): { readonly stdin: StreamWritable; readonly stdout: StreamReadable } {
  const handle = base.environment.subprocess.spawn({
    argv: [...plan.adapter.command, ...plan.adapter.args],
    cwd: plan.adapter.cwd,
    env: plan.adapter.env,
    stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
    graceMs: 5000,
  })
  if (handle.stdin === undefined || handle.stdout === undefined) {
    throw new DebugError('adapter process did not provide piped stdio', 'DEBUG_LAUNCH_FAILED')
  }
  return { stdin: handle.stdin, stdout: handle.stdout }
}

async function orchestrate(base: OrchestrationBase, mode: 'launch' | 'attach'): Promise<DebugSessionRecord> {
  const sessionId = allocateSessionId()
  let backend: LaunchBackend | undefined
  try {
    const plan = await base.resolvePlan()
    const resolved = await base.environment.adapters.resolve(base.provider.id)
    void resolved
    backend = await base.createBackend(spawnAdapter(base, plan))
    const outcome = await backend.start({
      launch: { request: mode, ...plan.dapRequest } as Readonly<Record<string, JsonValue>>,
      timeoutMs: base.requestTimeoutMs ?? 30_000,
    })

    const bound: LaunchBackend = backend
    const record: DebugSessionRecord = {
      id: sessionId,
      providerId: base.provider.id,
      workspaceId: base.workspaceId,
      ownerSessionId: base.callerSessionId,
      state: outcome.terminated ? 'terminated' : outcome.stop !== undefined ? 'stopped' : 'running',
      setState(next) {
        record.state = next
      },
      dispose: async () => {
        await bound.dispose()
      },
    }
    base.registry.add(record)
    base.breakpoints?.bindSession(record, request => bound.setBreakpoints(request))

    base.append('debug/session-started', {
      sessionId,
      providerId: base.provider.id,
      language: base.provider.displayName,
      mode,
    }, { ignorable: true })
    if (outcome.stop !== undefined) {
      base.append('debug/stopped', { sessionId, ...outcome.stop }, { ignorable: true })
    } else if (outcome.terminated) {
      base.append('debug/session-ended', { sessionId, outcome: 'terminated' }, { ignorable: true })
    }
    return record
  } catch (error) {
    await backend?.dispose()
    base.append('debug/session-ended', { sessionId, outcome: 'failed' }, { ignorable: true })
    if (error instanceof DebugError) throw error
    const detail = error instanceof Error ? error.message : String(error)
    throw new DebugError('debug ' + mode + ' failed: ' + detail, 'DEBUG_LAUNCH_FAILED')
  }
}

/**
 * Launches one debug session through the injected dependencies.
 *
 * @param deps - request, provider, environment, registry, durable writer,
 *   and the injected backend factory.
 * @returns The registered session record.
 * @throws DebugError(`DEBUG_LAUNCH_FAILED`) when any stage fails; the
 *   backend is disposed and `debug/session-ended` with `failed` is appended.
 */
export function launchDebugSession(deps: LaunchDependencies): Promise<DebugSessionRecord> {
  return orchestrate({
    ...deps,
    workspaceId: deps.request.workspaceId,
    callerSessionId: deps.request.caller.sessionId,
    resolvePlan: () => deps.provider.resolveLaunch(deps.request, deps.environment),
  }, 'launch')
}

/**
 * Attaches one debug session through the same path as launch; attach never
 * falls back to a host-local adapter.
 *
 * @param deps - attach request plus the same injected dependencies.
 * @returns The registered session record.
 * @throws DebugError(`DEBUG_LAUNCH_FAILED`) on failure, with the same
 *   cleanup and durable-failure semantics as launch.
 */
export function attachDebugSession(deps: AttachDependencies): Promise<DebugSessionRecord> {
  return orchestrate({
    ...deps,
    workspaceId: deps.request.workspaceId,
    callerSessionId: deps.request.caller.sessionId,
    resolvePlan: () => deps.provider.resolveAttach(deps.request, deps.environment),
  }, 'attach')
}
