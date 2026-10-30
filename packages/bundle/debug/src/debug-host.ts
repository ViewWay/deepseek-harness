/**
 * The production debug launch host: the composition-level plugin that turns
 * `ctx.debug.launch`/`attach` into real sessions. It probes the local
 * execution world once, resolves managed adapters with install-on-miss
 * through `ctx.debugAdapters`, spawns the adapter over the world's subprocess
 * service, drives the DAP handshake through `DapDebugBackend`, registers the
 * session backend, and mirrors the launch's durable facts onto the caller's
 * session log.
 * @module @deepseek-ai/dsh-debug-bundle/debug-host
 */

import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { DebugError, DebugSessionId, DebugThreadId, attachDebugSession, launchDebugSession, probeDebugEnvironment } from '@deepseek-ai/dsh-debug'
import type {
  DebugAttachRequest,
  DebugCapabilities,
  DebugDurableAppend,
  DebugEnvironment,
  DebugLaunchOrchestrator,
  DebugLaunchRequest,
  DebugProvider,
  DebugProviderId,
  DebugStackFrame,
  JsonValue,
  LaunchBackend,
  LaunchOutcome,
  ResolvedDebugAdapter,
} from '@deepseek-ai/dsh-debug'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import { DEFAULT_CONSOLE_LIMIT, DapClient, DapDebugBackend, createStdioTransport } from '@deepseek-ai/dsh-debug-dap'
import type { DebugAdapterInstallEnvironment } from '@deepseek-ai/dsh-debug-adapter-manager'

declare module '@deepseek-ai/cordis' {
  interface Context {
    debugHost: DebugHost
  }
}

/** Default managed-adapter install root, matching the terminal-side layout. */
export const DEFAULT_INSTALL_ROOT = join(homedir(), '.cache', 'dsh', 'debug-adapters')

/** Default handshake and per-request budget, matching the domain's own default. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000

/** Default resume wait before a still-running target reports `running`. */
export const DEFAULT_RESUME_TIMEOUT_MS = 15_000

/** Diagnostic-tail bound for install-time subprocess output; a fixed bound, not a deployment choice. */
const INSTALL_COLLECT_BYTES = 65_536

/** Debug host deployment policy. */
export interface Config {
  /** Managed-adapter install root (default {@link DEFAULT_INSTALL_ROOT}). */
  readonly installRoot?: string
  /** Handshake and per-request budget in milliseconds. */
  readonly requestTimeoutMs?: number
  /** How long resume operations wait for the next stop before `running`. */
  readonly resumeTimeoutMs?: number
  /** Console ring capacity per session backend. */
  readonly consoleLimit?: number
}

/** The piped-stdio face the launch orchestration hands the backend factory. */
interface AdapterStdio {
  readonly stdin: { readonly writable: boolean }
  readonly stdout: { readonly readable: boolean }
}

/** The first-stop facts observed directly off the adapter's DAP event stream. */
interface FirstStopCapture {
  /** DAP thread id of the first `stopped` event, when one arrived. */
  threadId?: string
  /** Raw stop reason of the first `stopped` event, when one arrived. */
  reason?: string
  /** Whether a `terminated` event arrived before any stop. */
  terminated?: boolean
  /** Resolves once a `stopped` or `terminated` event has been observed. */
  readonly settled: Promise<void>
  /** Settles `settled`; the observer calls it exactly once. */
  settle(): void
}

/** Per-launch wiring the backend factory, capability publisher, and durable writer share. */
interface LaunchWiring {
  /**
   * Session id stamped onto backend snapshots. The orchestration allocates the
   * registry's session id after the handshake starts, so the backend carries
   * its own id in the same `debug-` + hex format.
   */
  readonly backendSessionId: DebugSessionId
  /** Version of the adapter this launch resolved, for the durable started event. */
  adapterVersion: string
  /** Capability snapshots observed before the session record committed. */
  readonly pendingCapabilities: DebugCapabilities[]
  /** The committed registry id, set once orchestration returns. */
  committedSessionId: DebugSessionId | undefined
  /** The DAP backend the factory built, registered once orchestration commits. */
  backend: DapDebugBackend | undefined
}

/**
 * The local world's install I/O: the archive flow's full face plus the two
 * members only the pypi flow needs, so either manifest source can install.
 */
interface LocalInstallEnvironment extends DebugAdapterInstallEnvironment {
  /** Fetch one JSON document (the PyPI version metadata). */
  fetchJson(url: string): Promise<unknown>
  /** Run one python invocation in the target world. */
  runPython(python: string, args: readonly string[]): Promise<{ exitCode: number; stdout?: string; stderr?: string }>
}

/** The closed stop-reason vocabulary of the durable `debug/stopped` event. */
const STOP_REASONS: ReadonlySet<string> = new Set([
  'breakpoint', 'step', 'pause', 'entry', 'exception', 'dataBreakpoint', 'instructionBreakpoint', 'restart',
])

/**
 * Creates the first-stop capture with its settlement deferred.
 * @returns the empty capture whose `settled` promise resolves on the first stop or termination.
 */
function createFirstStopCapture(): FirstStopCapture {
  let settleCapture: (() => void) | undefined
  const settled = new Promise<void>((resolveCapture) => {
    settleCapture = resolveCapture
  })
  return {
    settled,
    settle: () => {
      settleCapture?.()
    },
  }
}

/** Generate a backend session id suffix in the domain's format; predictability is fine. */
function backendHex(): string {
  let hex = ''
  for (let index = 0; index < 16; index += 1) hex += (Math.floor(Math.random() * 16)).toString(16)
  return hex
}

/* jscpd:ignore-start -- the record/verb readers, the Node-stream guard, the
   independent first-stop observation, and the top-frame settle loop are the
   stdio launch bridge's reference implementation; the twin in
   test-support/debug-e2e is that idiom's first definition. */
/**
 * Views one JSON value as a record, or undefined for anything else.
 * @param value - the JSON value.
 * @returns the string-keyed record view, or undefined for null, arrays, and non-objects.
 */
function asRecord(value: JsonValue | undefined): Readonly<Record<string, JsonValue>> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  return Object.fromEntries(Object.entries(value))
}

/**
 * Renders one request verb for an error message.
 * @param verb - the rejected `request` field.
 * @returns the verb text itself, or its JSON form for non-string values.
 */
function verbText(verb: JsonValue | undefined): string {
  return typeof verb === 'string' ? verb : JSON.stringify(verb)
}

/**
 * Reads one payload member as a string.
 * @param payload - the durable-event payload the orchestration committed.
 * @param key - the member to read.
 * @returns the member's text, or an empty string when it is absent or not a string.
 */
function payloadString(payload: Readonly<Record<string, JsonValue>>, key: string): string {
  const value = payload[key]
  return typeof value === 'string' ? value : ''
}

/**
 * Reads one payload member as a number.
 * @param payload - the durable-event payload the orchestration committed.
 * @param key - the member to read.
 * @returns the member's value, or zero when it is absent or not a number.
 */
function payloadNumber(payload: Readonly<Record<string, JsonValue>>, key: string): number {
  const value = payload[key]
  return typeof value === 'number' ? value : 0
}

function isNodeReadable(value: unknown): value is Readable {
  return typeof value === 'object' && value !== null
    && typeof (value as { readable?: unknown }).readable === 'boolean'
    && typeof (value as { read?: unknown }).read === 'function'
    && typeof (value as { resume?: unknown }).resume === 'function'
}

function isNodeWritable(value: unknown): value is Writable {
  return typeof value === 'object' && value !== null
    && typeof (value as { writable?: unknown }).writable === 'boolean'
    && typeof (value as { write?: unknown }).write === 'function'
}

/**
 * Narrows the launch face's stdio to real Node streams. The local subprocess
 * runtime always spawns pipe-backed Node streams; the guard fails typed if a
 * future world hands the minimal face to a local launch.
 * @param stdio - the backend factory's stdio face.
 * @param sessionId - the backend's session id, for the typed failure.
 * @returns the same streams, narrowed to Node `Readable`/`Writable`.
 * @throws DebugError(`DEBUG_LAUNCH_FAILED`) when either stream is not a Node stream.
 */
function nodePipesOf(
  stdio: AdapterStdio,
  sessionId: DebugSessionId,
): { stdin: Writable; stdout: Readable } {
  const { stdin, stdout } = stdio
  if (!isNodeWritable(stdin) || !isNodeReadable(stdout)) {
    throw new DebugError('the debug host requires Node stream stdio from the local subprocess world', 'DEBUG_LAUNCH_FAILED', { sessionId })
  }
  return { stdin, stdout }
}

/** Best-effort client teardown; a dead adapter's destroyed transport must not mask the primary failure. */
async function disposeContained(client: DapClient): Promise<void> {
  try {
    await client.dispose()
  } catch {
    // The transport was already gone; containment keeps the original failure observable.
  }
}

/**
 * Records the first stop or termination straight off the DAP event stream.
 * The handshake consumes its own listeners, so the host keeps an independent
 * observation of the same events to build `LaunchOutcome`.
 * @param client - the connected DAP client.
 * @param capture - the capture to fill and settle.
 */
function observeFirstStop(client: DapClient, capture: FirstStopCapture): void {
  client.onEvent((event) => {
    if (event.event === 'terminated') {
      capture.terminated = true
      capture.settle()
      return
    }
    if (event.event !== 'stopped') return
    const body = asRecord(event.body)
    if (body === undefined) return
    const threadId = body['threadId']
    const reason = body['reason']
    if (typeof threadId === 'number') capture.threadId = String(threadId)
    if (typeof reason === 'string') capture.reason = reason
    capture.settle()
  })
}

/**
 * Reads the stopped thread's top frame through the backend, tolerating the
 * backend's stop snapshot lagging the raw stopped event.
 * @param dap - the session backend over the connection that carries the stop.
 * @param threadId - the stopped thread.
 * @param budgetMs - how long the snapshot may take to settle.
 * @returns the top frame, or undefined when the adapter reports none.
 * @throws the backend's failure once the budget is spent.
 */
async function topFrameWhenStopped(
  dap: DapDebugBackend,
  threadId: DebugThreadId,
  budgetMs: number,
): Promise<DebugStackFrame | undefined> {
  const deadline = Date.now() + budgetMs
  for (;;) {
    try {
      const stack = await dap.stackTrace(threadId, { levels: 1 })
      return stack.frames[0]
    } catch (error: unknown) {
      if (!(error instanceof DebugError) || error.code !== 'DEBUG_NOT_STOPPED' || Date.now() >= deadline) throw error
    }
    await new Promise((keepWaiting) => {
      setTimeout(keepWaiting, 100)
    })
  }
}

/**
 * Folds the observed first stop into `LaunchOutcome`.
 * @param dap - the session backend over the connection that carries the stop.
 * @param capture - the first-stop observation filled during the handshake.
 * @param budgetMs - how long the stop snapshot may take to settle.
 * @returns the outcome the launch orchestration records.
 */
async function firstStopOutcomeOf(
  dap: DapDebugBackend,
  capture: FirstStopCapture,
  budgetMs: number,
): Promise<LaunchOutcome> {
  if (capture.terminated) return { terminated: true }
  const threadId = capture.threadId
  if (threadId === undefined) return { terminated: true }
  const frame = await topFrameWhenStopped(dap, DebugThreadId(threadId), budgetMs)
  return {
    terminated: false,
    stop: {
      reason: capture.reason ?? 'entry',
      threadId,
      source: frame?.source?.workspaceRelativePath ?? frame?.source?.absolutePath ?? '<unknown source>',
      line: frame?.line ?? 0,
    },
  }
}
/* jscpd:ignore-end */

/** Whether one local path exists; the install bridge's presence check. */
async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/**
 * Download one file's bytes over the local world's HTTP stack.
 * @param url - the archive or wheel URL.
 * @returns the downloaded bytes.
 * @throws Error when the server answers a non-OK status.
 */
async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`downloading ${url} failed with status ${response.status}`)
  return new Uint8Array(await response.arrayBuffer())
}

/**
 * Download one JSON document over the local world's HTTP stack.
 * @param url - the metadata URL.
 * @returns the parsed document.
 * @throws Error when the server answers a non-OK status or the body is not JSON.
 */
async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`downloading ${url} failed with status ${response.status}`)
  return await response.json()
}

/**
 * `ctx.debugHost`: the launch orchestrator this bundle installs. The domain
 * stays DAP-free; this plugin owns the environment probe, managed-adapter
 * resolution with install-on-miss, the stdio DAP backend, capability
 * publication onto the live event bus, and the caller session's durable
 * `debug/*` events.
 */
export class DebugHost extends Service implements DebugLaunchOrchestrator {
  static inject = ['debug', 'debugAdapters', 'subprocess', 'fs', 'sessions', 'sandboxPolicy']

  static Config: z<Config> = z.object({
    installRoot: z.string().default(DEFAULT_INSTALL_ROOT),
    requestTimeoutMs: z.natural().min(1).default(DEFAULT_REQUEST_TIMEOUT_MS),
    resumeTimeoutMs: z.natural().min(1).default(DEFAULT_RESUME_TIMEOUT_MS),
    consoleLimit: z.natural().min(1).default(DEFAULT_CONSOLE_LIMIT),
  })

  private readonly settings: Required<Config>
  private readonly platformKey: string
  private world: DebugEnvironment | undefined

  /**
   * @param ctx - host with the debug seam, adapter manager, subprocess, filesystem, sessions, and sandbox policy mounted.
   * @param config - deployment policy; schemastery has filled the defaulted fields before this constructor runs.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'debugHost')
    this.settings = config as Required<Config>
    this.platformKey = `${process.platform}-${process.arch}`
  }

  protected async [Service.init](): Promise<void> {
    this.world = await probeDebugEnvironment({
      subprocess: this.ctx.subprocess,
      fs: this.ctx.fs,
      workspaceRoot: this.ctx.sandboxPolicy.workspaceRoot,
      platformKey: this.platformKey,
      adapters: { resolve: providerId => this.resolveAdapter(providerId) },
    })
    // The probe can finish after an unload has started; install nothing then.
    if (this.ctx.fiber.uid === null) return
    this.ctx.effect(() => {
      const uninstall = this.ctx.debug.installLaunchOrchestrator(this)
      return () => {
        uninstall()
      }
    }, 'debugHost.installLaunchOrchestrator()')
  }

  /**
   * Launch one debug session for the request's provider.
   * @param request - the validated launch request; the caller session must be live.
   * @returns the registered session's id.
   * @throws {@link DebugError} `DEBUG_ADAPTER_NOT_FOUND` for an unregistered
   * provider or an unresolvable adapter; `DEBUG_SESSION_GONE` when the caller
   * session is not live; launch failures propagate from the orchestration.
   */
  async launch(request: DebugLaunchRequest): Promise<DebugSessionId> {
    return await this.orchestrate(request)
  }

  /**
   * Attach to a running target for the request's provider.
   * @param request - the validated attach request; the caller session must be live.
   * @returns the registered session's id.
   * @throws the same typed failures as {@link launch}.
   */
  async attach(request: DebugAttachRequest): Promise<DebugSessionId> {
    return await this.orchestrate(request)
  }

  /** Run one launch or attach end to end and register the resulting session. */
  private async orchestrate(request: DebugLaunchRequest | DebugAttachRequest): Promise<DebugSessionId> {
    const world = this.requireWorld()
    const provider = this.requireProvider(request.providerId)
    const caller = this.requireCallerSession(request.caller.sessionId, 'cwd' in request ? 'launch' : 'attach')
    const startedAt = Date.now()
    const wiring: LaunchWiring = {
      backendSessionId: DebugSessionId(`debug-${backendHex()}`),
      adapterVersion: 'unknown',
      pendingCapabilities: [],
      committedSessionId: undefined,
      backend: undefined,
    }
    const environment: DebugEnvironment = {
      ...world,
      workspaceRoot: request.workspaceRoot,
      cwd: 'cwd' in request ? request.cwd : request.workspaceRoot,
      adapters: {
        resolve: async (providerId) => {
          const resolved = await this.resolveAdapter(providerId)
          wiring.adapterVersion = resolved.version
          return resolved
        },
      },
    }
    const shared = {
      provider,
      environment,
      registry: this.ctx.debug.sessions,
      append: this.durableAppendOf(request, caller, wiring, startedAt),
      createBackend: (stdio: AdapterStdio) => this.createBackend(stdio, request, wiring),
      breakpoints: this.ctx.debug.breakpoints,
      requestTimeoutMs: this.settings.requestTimeoutMs,
    }
    const record = 'cwd' in request
      ? await launchDebugSession({ ...shared, request })
      : await attachDebugSession({ ...shared, request })
    wiring.committedSessionId = record.id
    for (const capabilities of wiring.pendingCapabilities.splice(0)) {
      this.publishCapabilities(record.id, request.workspaceId, capabilities)
    }
    const backend = wiring.backend
    if (backend !== undefined) this.registerBackendUntilTerminated(record.id, backend)
    return record.id
  }

  /** The probed world, or a typed failure when the host has not finished init. */
  private requireWorld(): DebugEnvironment {
    if (this.world === undefined) {
      throw new DebugError('the debug host has not probed its execution world yet', 'DEBUG_UNAVAILABLE')
    }
    return this.world
  }

  /** Read one registered provider or fail with the seam's typed not-found code. */
  private requireProvider(providerId: DebugProviderId): DebugProvider {
    const provider = this.ctx.debug.provider(providerId)
    if (provider === undefined) {
      throw new DebugError(`no debug provider registered for "${providerId}"`, 'DEBUG_ADAPTER_NOT_FOUND', { providerId })
    }
    return provider
  }

  /**
   * Resolve the caller's session; the durable `debug/*` events need a live
   * owner, so a missing session fails before anything is spawned.
   */
  private requireCallerSession(sessionId: SessionId, mode: string): Session {
    const session = this.ctx.sessions.get(sessionId)
    if (session === undefined) {
      throw new DebugError(
        `debug ${mode} caller session "${sessionId}" is not live; its durable debug events would have no owner`,
        'DEBUG_SESSION_GONE',
      )
    }
    return session
  }

  /**
   * Resolve one provider's adapter, installing it first when the target world
   * holds no install. This is the adapter manager's first production caller
   * of `install`.
   * @param providerId - the provider whose managed adapter to resolve.
   * @returns the resolved adapter command for the local world.
   * @throws {@link DebugError} `DEBUG_ADAPTER_NOT_FOUND` when neither install
   * nor resolution can produce the adapter; install failures propagate their
   * own typed codes.
   */
  private async resolveAdapter(providerId: DebugProviderId): Promise<ResolvedDebugAdapter> {
    const call = {
      platform: this.platformKey,
      installRoot: this.settings.installRoot,
      environment: {
        pathSeparator: this.requireWorld().pathSeparator,
        exists: (path: string) => pathExists(path),
      },
    }
    try {
      return await this.ctx.debugAdapters.resolve(providerId, call)
    } catch (error: unknown) {
      if (!(error instanceof DebugError) || error.code !== 'DEBUG_ADAPTER_NOT_FOUND') throw error
    }
    await this.ctx.debugAdapters.install(providerId, {
      platform: call.platform,
      installRoot: call.installRoot,
      environment: this.installEnvironment(),
    })
    return await this.ctx.debugAdapters.resolve(providerId, call)
  }

  /**
   * The local world's install I/O. The harness filesystem service exposes no
   * byte-write face, so archive and wheel bytes move through the local
   * process's own filesystem and HTTP stack, and process faces run through
   * the world's subprocess service. Pypi sources additionally need target
   * interpreter facts on the install call; until a composition supplies them
   * the manager fails loud with `DEBUG_INVALID_CONFIG`.
   */
  private installEnvironment(): LocalInstallEnvironment {
    return {
      pathSeparator: this.requireWorld().pathSeparator,
      fetchBytes,
      fetchJson,
      write: async (path, bytes) => {
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, bytes)
      },
      remove: async (path) => {
        await rm(path, { recursive: true, force: true })
      },
      exists: pathExists,
      runSelfTest: command => this.runInstallProcess(command),
      runPython: (python, args) => this.runInstallProcess([python, ...args]),
    }
  }

  /** Run one install-time subprocess through the world's subprocess service. */
  private async runInstallProcess(argv: readonly string[]): Promise<{ exitCode: number; stdout?: string; stderr?: string }> {
    const handle = this.ctx.subprocess.spawn({
      argv,
      cwd: process.cwd(),
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: INSTALL_COLLECT_BYTES },
        stderr: { maxBytes: INSTALL_COLLECT_BYTES },
      },
      graceMs: this.settings.requestTimeoutMs,
    })
    const outcome = await handle.done
    return {
      exitCode: outcome.exitCode ?? 1,
      ...(handle.collected.stdout !== undefined ? { stdout: handle.collected.stdout.readFrom(0).text } : {}),
      ...(handle.collected.stderr !== undefined ? { stderr: handle.collected.stderr.readFrom(0).text } : {}),
    }
  }

  /**
   * Build the durable writer that mirrors the orchestration's committed facts
   * onto the caller's session log, enriching each payload with the host-known
   * members the domain's launch outcome does not carry.
   * @param request - the launch or attach request being orchestrated.
   * @param caller - the live session that owns the durable events.
   * @param wiring - the launch's wiring, for the resolved adapter version.
   * @param startedAt - the orchestration's start time, for the lifetime fact.
   * @returns the writer the orchestration commits through.
   */
  private durableAppendOf(
    request: DebugLaunchRequest | DebugAttachRequest,
    caller: Session,
    wiring: LaunchWiring,
    startedAt: number,
  ): DebugDurableAppend {
    return (type, payload) => {
      switch (type) {
        case 'debug/session-started':
          caller.append('debug/session-started', {
            sessionId: payloadString(payload, 'sessionId'),
            providerId: payloadString(payload, 'providerId'),
            language: payloadString(payload, 'language'),
            mode: payloadString(payload, 'mode') === 'attach' ? 'attach' : 'launch',
            workspaceRoot: request.workspaceRoot,
            adapterVersion: wiring.adapterVersion,
          })
          return
        case 'debug/stopped':
          caller.append('debug/stopped', {
            sessionId: payloadString(payload, 'sessionId'),
            reason: stopReasonOf(payloadString(payload, 'reason')),
            threadId: payloadString(payload, 'threadId'),
            source: payloadString(payload, 'source'),
            line: payloadNumber(payload, 'line'),
            // The launch outcome carries no column fact; zero marks it unknown.
            column: 0,
          })
          return
        case 'debug/session-ended': {
          const outcome = payloadString(payload, 'outcome') === 'failed' ? 'failed' as const : 'terminated' as const
          caller.append('debug/session-ended', {
            sessionId: payloadString(payload, 'sessionId'),
            outcome,
            reason: `debug session ${outcome}`,
            durationMs: Date.now() - startedAt,
          })
          return
        }
      }
    }
  }

  /**
   * Build the stdio DAP backend for one spawned adapter and wrap it into the
   * launch orchestration's backend slice.
   * @param stdio - the spawned adapter's piped stdio.
   * @param request - the request being orchestrated, for the workspace root.
   * @param wiring - the launch's wiring; receives the built backend.
   * @returns the orchestration-facing backend.
   */
  private createBackend(
    stdio: AdapterStdio,
    request: DebugLaunchRequest | DebugAttachRequest,
    wiring: LaunchWiring,
  ): Promise<LaunchBackend> {
    const pipes = nodePipesOf(stdio, wiring.backendSessionId)
    const client = new DapClient(createStdioTransport(pipes))
    const capture = createFirstStopCapture()
    const dap = new DapDebugBackend(client, {
      sessionId: wiring.backendSessionId,
      workspaceRoot: request.workspaceRoot,
      requestTimeoutMs: this.settings.requestTimeoutMs,
      resumeTimeoutMs: this.settings.resumeTimeoutMs,
      consoleLimit: this.settings.consoleLimit,
      onCapabilitiesChanged: (capabilities) => {
        this.receiveCapabilities(wiring, request.workspaceId, capabilities)
      },
    })
    observeFirstStop(client, capture)
    wiring.backend = dap
    const separator = this.requireWorld().pathSeparator
    return Promise.resolve({
      start: async ({ launch, timeoutMs }) => {
        const { request: verb, ...launchArguments } = launch
        if (verb !== 'launch' && verb !== 'attach') {
          throw new DebugError(`unsupported debug request verb ${verbText(verb)}`, 'DEBUG_INVALID_CONFIG')
        }
        await dap.start({ launch: { request: verb, ...launchArguments }, timeoutMs })
        return await firstStopOutcomeOf(dap, capture, this.settings.requestTimeoutMs)
      },
      setBreakpoints: setRequest => dap.setBreakpoints({
        source: {
          workspaceRelativePath: setRequest.source,
          absolutePath: [request.workspaceRoot, setRequest.source].join(separator),
        },
        breakpoints: setRequest.breakpoints,
      }),
      dispose: async () => {
        await disposeContained(client)
        if (!pipes.stdin.destroyed) pipes.stdin.end()
      },
    })
  }

  /** Publish or buffer one capability snapshot; snapshots before the record commits are buffered. */
  private receiveCapabilities(wiring: LaunchWiring, workspaceId: string, capabilities: DebugCapabilities): void {
    const sessionId = wiring.committedSessionId
    if (sessionId === undefined) {
      wiring.pendingCapabilities.push(capabilities)
      return
    }
    this.publishCapabilities(sessionId, workspaceId, capabilities)
  }

  /** Publish one capability snapshot onto the live event bus. */
  private publishCapabilities(sessionId: DebugSessionId, workspaceId: string, capabilities: DebugCapabilities): void {
    this.ctx.debug.sessions.publish({ kind: 'capabilities/changed', sessionId, workspaceId, capabilities })
  }

  /** Register the backend until its session terminates; removal releases the registration. */
  private registerBackendUntilTerminated(sessionId: DebugSessionId, backend: DapDebugBackend): void {
    const unregister = this.ctx.debug.registerBackend(sessionId, backend)
    this.ctx.effect(() => {
      const unsubscribe = this.ctx.debug.events.subscribe({ sessionId }, (event) => {
        if (event.kind !== 'session/terminated') return
        unregister()
      })
      return () => {
        unsubscribe()
        unregister()
      }
    }, 'debugHost.registerBackend()')
  }
}

/** The durable `debug/stopped` event's closed reason vocabulary. */
type StopReason = 'breakpoint' | 'step' | 'pause' | 'entry' | 'exception' | 'dataBreakpoint' | 'instructionBreakpoint' | 'restart' | 'unknown'

/** Narrow one stop reason onto the durable event's closed vocabulary. */
function stopReasonOf(reason: string): StopReason {
  return STOP_REASONS.has(reason) ? reason as Exclude<StopReason, 'unknown'> : 'unknown'
}

export default DebugHost
