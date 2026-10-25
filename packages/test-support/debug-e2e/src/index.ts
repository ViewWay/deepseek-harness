/**
 * Real-adapter debug e2e harness primitives.
 *
 * Every process launch in this module belongs to the shipped launch
 * orchestration (`launchDebugSession` spawns the adapter through the injected
 * subprocess service); the harness itself contains zero process-launch calls
 * by construction. `skipWithoutAdapter` decides availability from PATH
 * membership and adapter layout checks only, and `launchFixture` composes the
 * real provider, the committed orchestration, and the real DAP backend.
 * Adapter provisioning is terminal-side (see README); a missing provision is a
 * typed launch failure, never a mock.
 * @module @deepseek-ai/dsh-debug-e2e
 */
import { accessSync, constants as fsConstants, existsSync } from 'node:fs'
import { connect as netConnect } from 'node:net'
import { homedir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import type { Duplex, Readable, Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Debug, {
  DebugError,
  DebugProviderId,
  DebugSessionId,
  DebugThreadId,
  launchDebugSession,
} from '@deepseek-ai/dsh-debug'
import type {
  DebugEnvironment,
  DebugExecutionCapability,
  DebugResumeResult,
  DebugSessionState,
  DebugStepKind,
  JsonValue,
  LaunchBackend,
  ResolvedDebugAdapter,
} from '@deepseek-ai/dsh-debug'
import {
  DEFAULT_CONSOLE_LIMIT,
  DapClient,
  DapDebugBackend,
  connectDebugTunnel,
  createStdioTransport,
} from '@deepseek-ai/dsh-debug-dap'
import type { DapArguments, DebugTunnelConnector, DebugTunnelEndpoint } from '@deepseek-ai/dsh-debug-dap'
import { nodeDebugProvider } from '@deepseek-ai/dsh-debug-node'
import { pythonDebugProvider } from '@deepseek-ai/dsh-debug-python'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { SessionId } from '@deepseek-ai/dsh-session'

/** Languages the matrix covers. */
export type DebugE2eLanguage = 'node' | 'python' | 'go' | 'native'

/** Toolchain executable per language, probed on PATH without launching it. */
const TOOLCHAIN: Readonly<Record<DebugE2eLanguage, string>> = {
  node: 'node',
  python: 'python3',
  go: 'go',
  native: 'clang',
}

/** Environment variable carrying one adapter override path per language. */
const OVERRIDE_ENV: Readonly<Record<DebugE2eLanguage, string>> = {
  node: 'DSH_E2E_NODE_ADAPTER',
  python: 'DSH_E2E_PYTHON_ADAPTER',
  go: 'DSH_E2E_GO_ADAPTER',
  native: 'DSH_E2E_NATIVE_ADAPTER',
}

/** Environment variable relocating the managed adapter root; defaults to the cache layout. */
const ADAPTER_ROOT_ENV = 'DSH_E2E_ADAPTER_ROOT'

/** One language's launch facts: adapter command shape, transport, and verified upstream identity. */
interface DebugE2eMatrixEntry {
  /** Adapter command head; an interpreter for interpreter-run adapters. */
  readonly adapterExecutable: string
  /** Whether the adapter is a script the command head interprets (node/js-debug). */
  readonly interpreterRun: boolean
  /** Adapter arguments appended after the resolved entry (js-debug's port/socket argument). */
  readonly extraArgs: readonly string[]
  /** How the DAP client reaches the adapter. */
  readonly transport: 'socket' | 'stdio'
  /** The provider manifest's command; index 0 is replaced by the resolved interpreter or binary. */
  readonly manifestCommand: readonly string[]
  /** The pinned upstream version backing the managed layout. */
  readonly version: string
  /** Execution capabilities the language's launch plan requires. */
  readonly capabilities: readonly DebugExecutionCapability[]
}

/** Launch facts per matrix language, from each provider's verified manifest. */
const MATRIX: Readonly<Record<DebugE2eLanguage, DebugE2eMatrixEntry>> = {
  node: {
    adapterExecutable: 'node',
    interpreterRun: true,
    extraArgs: ['0'],
    transport: 'socket',
    manifestCommand: ['node', 'js-debug/src/dapDebugServer.js'],
    version: '1.140.0',
    capabilities: ['processControl'],
  },
  python: {
    adapterExecutable: 'python3',
    interpreterRun: false,
    extraArgs: [],
    transport: 'stdio',
    manifestCommand: ['python', '-m', 'debugpy.adapter'],
    version: '1.8.22',
    capabilities: ['processControl', 'python'],
  },
  go: {
    adapterExecutable: 'dlv',
    interpreterRun: false,
    extraArgs: [],
    transport: 'stdio',
    manifestCommand: ['dlv', 'dap'],
    version: 'host-path',
    capabilities: ['processControl', 'go'],
  },
  native: {
    adapterExecutable: 'lldb-dap',
    interpreterRun: false,
    extraArgs: [],
    transport: 'stdio',
    manifestCommand: ['lldb-dap'],
    version: 'host-path',
    capabilities: ['ptrace'],
  },
}

/** Recorded skip reasons, appended by every `skipWithoutAdapter` call that decides to skip. */
export const recordedSkipReasons: string[] = []

/** Package root the fixtures resolve against. */
const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url))

/** How long `continue`/`step` wait for the next stop before reporting `running`. */
const RESUME_TIMEOUT_MS = 15_000

/** How long the js-debug socket endpoint may take to announce itself. */
const SOCKET_ANNOUNCE_TIMEOUT_MS = 30_000

/**
 * js-debug's concrete adapter discriminator. The standalone DAP server
 * dispatches only on it; the provider plan's `type: 'node'` names the seam's
 * provider id, so the composition aliases it on the wire.
 */
const JS_DEBUG_TYPE = 'pwa-node'

/** Handshake and per-request budget for one fixture session. */
const REQUEST_TIMEOUT_MS = 30_000

/**
 * Whether one executable is present and executable on PATH, without launching it.
 *
 * POSIX `X_OK` probing; on Windows every path grants `X_OK`, so presence is the
 * whole check there.
 * @param executable - bare executable name to look up.
 * @returns whether some PATH directory holds an executable entry of that name.
 */
function resolvesOnPath(executable: string): boolean {
  const searchPath = process.env['PATH'] ?? ''
  for (const directory of searchPath.split(delimiter)) {
    if (directory === '') continue
    try {
      accessSync(join(directory, executable), fsConstants.X_OK)
      return true
    } catch {
      // Per-directory ENOENT/EACCES is the probe result itself, not a failure to contain.
    }
  }
  return false
}

/**
 * The managed adapter install root this host uses.
 * @returns the `$DSH_E2E_ADAPTER_ROOT` override, or the default cache root.
 */
function adapterRoot(): string {
  const override = process.env[ADAPTER_ROOT_ENV]
  if (override !== undefined && override !== '') return override
  return join(homedir(), '.cache', 'dsh', 'debug-adapters')
}

/**
 * The managed js-debug DAP-server entry inside the install layout.
 * @returns the layout path when provisioned, else undefined.
 */
function nodeAdapterExecutable(): string | undefined {
  const platform = `${process.platform}-${process.arch}`
  const entry = MATRIX.node.manifestCommand[1]
  if (entry === undefined) return undefined
  const candidate = join(adapterRoot(), 'node', MATRIX.node.version, platform, entry)
  return existsSync(candidate) ? candidate : undefined
}

/**
 * The managed debugpy venv interpreter inside the install layout.
 * @returns the venv interpreter when provisioned, else undefined.
 */
function pythonVenvInterpreter(): string | undefined {
  const candidate = join(adapterRoot(), 'python', MATRIX.python.version, 'venv', 'bin', 'python')
  return existsSync(candidate) ? candidate : undefined
}

/**
 * Reports whether one language can run its real e2e path on this host.
 *
 * Go and native are explicit skips this wave — their closed loops land with
 * the adapter-matrix follow-up, so a present toolchain never promotes them to
 * a run. The other languages are decided without launching anything: the
 * toolchain and the adapter executable are PATH-membership checks, the
 * override is a layout check, and python defers to the launch itself (the real
 * launch is the stronger debugpy probe).
 * @param language - The matrix language.
 * @returns `false` when the language can launch for real; otherwise the
 *   human-readable skip reason (also recorded in `recordedSkipReasons`).
 */
export function skipWithoutAdapter(language: DebugE2eLanguage): string | false {
  if (language === 'go' || language === 'native') {
    const reason = `${language} e2e skipped: explicit skip this wave; the ${MATRIX[language].adapterExecutable} closed loop lands with the adapter-matrix follow-up`
    recordedSkipReasons.push(reason)
    return reason
  }
  const tool = TOOLCHAIN[language]
  if (!resolvesOnPath(tool)) {
    const reason = `${language} e2e skipped: toolchain ${tool} is not available on PATH`
    recordedSkipReasons.push(reason)
    return reason
  }
  const override = process.env[OVERRIDE_ENV[language]]
  if (override !== undefined && override !== '' && existsSync(override)) return false
  if (language === 'python') return false
  if (nodeAdapterExecutable() === undefined) {
    const reason = `${language} e2e skipped: no adapter override at $${OVERRIDE_ENV[language]} and no managed install on this host`
    recordedSkipReasons.push(reason)
    return reason
  }
  return false
}

/**
 * Resolves one language's adapter command against its override or managed layout.
 *
 * The override wins when present: an interpreter-run adapter overrides its
 * script entry, a self-contained adapter overrides its whole command head. The
 * managed path follows the adapter manager's install layouts. Python without a
 * provision still resolves to the toolchain interpreter and lets the real
 * launch decide (the launch is the debugpy probe).
 * @param language - The matrix language.
 * @returns the resolved adapter command for the launch orchestration to spawn.
 * @throws {@link DebugError} `DEBUG_ADAPTER_NOT_FOUND` when neither the
 *   override nor the managed layout provides the adapter.
 */
function ensureAdapter(language: DebugE2eLanguage): ResolvedDebugAdapter {
  const matrix = MATRIX[language]
  const platform = `${process.platform}-${process.arch}`
  const override = process.env[OVERRIDE_ENV[language]]
  if (override !== undefined && override !== '' && existsSync(override)) {
    // An interpreter-run adapter overrides its script entry; a self-contained
    // adapter overrides its whole command head.
    return matrix.interpreterRun
      ? {
        command: [matrix.adapterExecutable],
        args: [override, ...matrix.extraArgs],
        env: {},
        version: matrix.version,
        platform,
        source: 'override',
        executablePath: override,
      }
      : {
        command: [override],
        args: [...matrix.manifestCommand.slice(1), ...matrix.extraArgs],
        env: {},
        version: matrix.version,
        platform,
        source: 'override',
        executablePath: override,
      }
  }
  if (language === 'python') {
    const venvPython = pythonVenvInterpreter()
    const head = venvPython ?? matrix.adapterExecutable
    return {
      command: [head],
      args: [...matrix.manifestCommand.slice(1), ...matrix.extraArgs],
      env: {},
      version: matrix.version,
      platform,
      source: venvPython === undefined ? 'override' : 'managed',
      executablePath: venvPython ?? head,
    }
  }
  if (language === 'node') {
    const entry = nodeAdapterExecutable()
    if (entry === undefined) {
      throw new DebugError(
        'debug e2e: the node adapter (js-debug) is not provisioned',
        'DEBUG_ADAPTER_NOT_FOUND',
        { providerId: DebugProviderId(language), detail: `expected an override at $${OVERRIDE_ENV[language]} or a managed install under ${adapterRoot()}` },
      )
    }
    return {
      command: [matrix.adapterExecutable],
      args: [entry, ...matrix.extraArgs],
      env: {},
      version: matrix.version,
      platform,
      source: 'managed',
      executablePath: entry,
    }
  }
  if (!resolvesOnPath(matrix.adapterExecutable)) {
    throw new DebugError(
      `debug e2e: the ${language} adapter (${matrix.adapterExecutable}) is not on PATH`,
      'DEBUG_ADAPTER_NOT_FOUND',
      { providerId: DebugProviderId(language), detail: `expected an override at $${OVERRIDE_ENV[language]} or ${matrix.adapterExecutable} on PATH` },
    )
  }
  return {
    command: [matrix.adapterExecutable],
    args: [...matrix.manifestCommand.slice(1), ...matrix.extraArgs],
    env: {},
    version: matrix.version,
    platform,
    source: 'managed',
    executablePath: matrix.adapterExecutable,
  }
}

/** The first-stop facts the harness observes directly off the DAP event stream. */
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

/**
 * Creates the capture with its settlement deferred.
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

/** Environment toggle that mirrors every adapter DAP event onto the test log. */
const EVENT_TRACE_ENV = 'DSH_E2E_TRACE'

/**
 * Views one JSON value as a record, or undefined for anything else.
 * @param value - The JSON value.
 * @returns the string-keyed record view, or undefined for null, arrays, and non-objects.
 */
function asRecord(value: JsonValue | undefined): Readonly<Record<string, JsonValue>> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  return Object.fromEntries(Object.entries(value))
}

/**
 * Resolves once the js-debug server announces its socket endpoint on stdout.
 * @param stdout - The adapter process's piped stdout.
 * @returns the announced host and port.
 * @throws {@link DebugError} `DEBUG_LAUNCH_FAILED` when the announcement does
 *   not arrive within {@link SOCKET_ANNOUNCE_TIMEOUT_MS} or the stream fails first.
 */
function announcedEndpoint(stdout: Readable): Promise<DebugTunnelEndpoint> {
  return new Promise<DebugTunnelEndpoint>((resolveEndpoint, rejectEndpoint) => {
    let received = ''
    function detach(): void {
      clearTimeout(timer)
      stdout.off('data', onData)
      stdout.off('error', onError)
    }
    const timer = setTimeout(() => {
      detach()
      rejectEndpoint(new DebugError('the adapter did not announce a socket endpoint in time', 'DEBUG_LAUNCH_FAILED'))
    }, SOCKET_ANNOUNCE_TIMEOUT_MS)
    const onData = (chunk: string | Buffer): void => {
      received += String(chunk)
      const [, host, portText] = /listening at ([\d.]+):(\d+)/u.exec(received) ?? []
      if (host === undefined || portText === undefined) return
      detach()
      resolveEndpoint({ host, port: Number(portText) })
    }
    const onError = (error: Error): void => {
      detach()
      rejectEndpoint(new DebugError('the adapter output failed before announcing: ' + error.message, 'DEBUG_LAUNCH_FAILED'))
    }
    stdout.on('data', onData)
    stdout.on('error', onError)
  })
}

/** Connects one loopback TCP stream for the socket-transport adapters. */
const socketConnector: DebugTunnelConnector = {
  async connectTcpStream(host: string, port: number): Promise<Duplex> {
    return await new Promise<Duplex>((open, fail) => {
      const socket = netConnect({ host, port })
      socket.once('connect', () => {
        open(socket)
      })
      socket.once('error', (error: Error) => {
        fail(error)
      })
    })
  },
}

/**
 * Records the first stop or termination straight off the DAP event stream.
 *
 * The handshake consumes its own listeners, so the harness keeps an independent
 * observation of the same events to build `LaunchOutcome`. With
 * `$DSH_E2E_TRACE` set, every adapter event is mirrored onto the test log.
 * @param client - The connected DAP client.
 * @param capture - The capture to fill and settle.
 */
function observeFirstStop(client: DapClient, capture: FirstStopCapture): void {
  const tracing = process.env[EVENT_TRACE_ENV] === '1'
  client.onEvent((event) => {
    if (tracing) console.log('[adapter]', event.event, JSON.stringify(event.body ?? {}).slice(0, 200))
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

/** Best-effort client teardown; a dead adapter's destroyed transport must not mask the primary failure. */
async function disposeContained(client: DapClient): Promise<void> {
  try {
    await client.dispose()
  } catch {
    // The transport was already gone; containment keeps the original failure observable.
  }
}

/**
 * Resolves on the next DAP event of one kind over the client.
 * @param client - The client to observe.
 * @param event - The event name.
 * @param signal - Aborts the wait with `DEBUG_TIMEOUT`.
 * @returns resolves once the event arrives.
 */
function nextEvent(client: DapClient, event: string, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolveEvent, rejectEvent) => {
    const disposeListener = client.onEvent((received) => {
      if (received.event !== event) return
      disposeListener()
      resolveEvent()
    })
    signal.addEventListener('abort', () => {
      disposeListener()
      rejectEvent(new DebugError(`the adapter never sent ${event} in time`, 'DEBUG_TIMEOUT'))
    }, { once: true })
  })
}

/** The initialize arguments every fixture handshake sends. */
function initializeArguments(): DapArguments {
  return {
    clientID: 'dsh',
    adapterID: 'dsh',
    linesStartAt1: true,
    columnsStartAt1: true,
    pathFormat: 'path',
    supportsRunInTerminalRequest: true,
    supportsStartDebuggingRequest: true,
  }
}

/** Fails one adapter response that must succeed. */
function requireSuccess(response: { readonly success: boolean; readonly message?: string }, command: string): void {
  if (response.success) return
  throw new DebugError(`the adapter rejected ${command}: ${response.message ?? 'no detail'}`, 'DEBUG_LAUNCH_FAILED')
}

/** The absolute-path source a fixture request resolves to. */
function fixtureSource(relative: string): { readonly workspaceRelativePath: string; readonly absolutePath: string } {
  return { workspaceRelativePath: relative, absolutePath: resolve(PACKAGE_ROOT, relative) }
}

/**
 * Waits until the observer has seen the first stop or termination.
 * @param capture - The capture whose settlement is awaited.
 * @param signal - Aborts the wait with `DEBUG_TIMEOUT`.
 * @returns resolves once the capture is filled.
 */
async function awaitFirstStop(capture: FirstStopCapture, signal: AbortSignal): Promise<void> {
  await Promise.race([
    capture.settled,
    new Promise<never>((_, reject) => {
      signal.addEventListener('abort', () => {
        reject(new DebugError('the adapter never reported the first stop in time', 'DEBUG_TIMEOUT'))
      }, { once: true })
    }),
  ])
}

/** How long the backend's stop snapshot may lag the raw stopped event. */
const STOP_SNAPSHOT_SETTLE_MS = 5_000

/**
 * Reads the stopped thread's top frame through the backend, tolerating the
 * backend's stop snapshot lagging the raw stopped event (its own stack-trace
 * round-trip settles first).
 * @param dap - The session backend over the connection that carries the stop.
 * @param threadId - The stopped thread.
 * @returns the top frame.
 * @throws {@link DebugError} when the backend never observes the stop.
 */
async function topFrameWhenStopped(dap: DapDebugBackend, threadId: DebugThreadId): Promise<import('@deepseek-ai/dsh-debug').DebugStackFrame | undefined> {
  const deadline = Date.now() + STOP_SNAPSHOT_SETTLE_MS
  for (;;) {
    try {
      const stack = await dap.stackTrace(threadId, { levels: 1 })
      return stack.frames[0]
    } catch (error: unknown) {
      if (!(error instanceof DebugError) || error.code !== 'DEBUG_NOT_STOPPED' || Date.now() >= deadline) throw error
    }
    await new Promise((keepWaiting) => { setTimeout(keepWaiting, 100) })
  }
}

/**
 * Folds the observed first stop into `LaunchOutcome`, resolving the top stack
 * frame of the stopped thread through the backend.
 * @param dap - The session backend over the connection that carries the stop.
 * @param capture - The first-stop observation filled during the handshake.
 * @returns the outcome the launch orchestration records.
 */
async function firstStopOutcome(dap: DapDebugBackend, capture: FirstStopCapture): Promise<Awaited<ReturnType<LaunchBackend['start']>>> {
  if (capture.terminated) return { terminated: true }
  const threadId = capture.threadId
  if (threadId === undefined) return { terminated: true }
  const thread = DebugThreadId(threadId)
  const frame = await topFrameWhenStopped(dap, thread)
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

/**
 * Adapts the real DAP backend to the launch orchestration's backend slice for
 * the stdio adapters (debugpy), folding the observed first stop into
 * `LaunchOutcome`.
 * @param dap - The real DAP backend for the session.
 * @param client - The client behind `dap`, disposed on teardown.
 * @param stdio - The adapter's piped stdin, ended on teardown to signal exit.
 * @param capture - The first-stop observation filled during the handshake.
 * @returns the orchestration-facing backend.
 */
function stdioLaunchBackendOf(
  dap: DapDebugBackend,
  client: DapClient,
  stdio: { readonly stdin: Writable; readonly stdout: Readable },
  capture: FirstStopCapture,
): LaunchBackend {
  return {
    async start({ launch, timeoutMs }) {
      // debugpy defers `initialized` until the start request is accepted by
      // pydevd and answers launch on configurationDone (its documented
      // vscode#4902 order), so this handshake sends launch before the
      // configuration stage. Capabilities stay uninstalled (the backend's
      // start is not used), which the handle's terminate already treats as a
      // disconnect fallback.
      const signal = AbortSignal.timeout(timeoutMs)
      const { request: verb, ...launchArguments } = launch
      if (verb !== 'launch' && verb !== 'attach') {
        throw new DebugError(`unsupported debug request verb ${String(verb)}`, 'DEBUG_INVALID_CONFIG')
      }
      requireSuccess(await client.request('initialize', initializeArguments(), signal), 'initialize')
      const launchSettled = client.request(verb, launchArguments, signal)
      await nextEvent(client, 'initialized', signal)
      requireSuccess(await client.request('configurationDone', {}, signal), 'configurationDone')
      requireSuccess(await launchSettled, verb)
      await awaitFirstStop(capture, signal)
      return await firstStopOutcome(dap, capture)
    },
    async setBreakpoints(request) {
      return await dap.setBreakpoints({
        source: fixtureSource(request.source),
        breakpoints: request.breakpoints,
      })
    },
    async dispose() {
      await disposeContained(client)
      if (!stdio.stdin.destroyed) stdio.stdin.end()
    },
  }
}

/** The reverse `startDebugging` payload js-debug's broker sends over the root connection. */
interface JsDebugStartDebuggingArgs {
  /** The verb the target session must launch with. */
  readonly request: string
  /** The target configuration; carries the `__pendingTargetId` the second connection claims. */
  readonly configuration: DapArguments
}

/**
 * Runs the root connection's launcher handshake: initialize, configurationDone,
 * launch, and the reverse `startDebugging` the broker answers with.
 *
 * js-debug's standalone server dispatches only on its concrete `pwa-node`
 * discriminator, so the launch type is aliased here; the provider plan's
 * `type: 'node'` names the seam's provider, not this adapter's vocabulary.
 * @param client - The root connection's DAP client.
 * @param launch - The orchestration's launch arguments (`request` verb included).
 * @param timeoutMs - Whole-stage budget.
 * @returns the reverse request's verb and target configuration.
 * @throws {@link DebugError} when any stage fails or the reverse request never arrives.
 */
async function rootLaunchUntilStartDebugging(
  client: DapClient,
  launch: Readonly<Record<string, JsonValue>>,
  timeoutMs: number,
): Promise<JsDebugStartDebuggingArgs> {
  const signal = AbortSignal.timeout(timeoutMs)
  let settleStartDebugging: ((args: JsDebugStartDebuggingArgs) => void) | undefined
  const startDebugging = new Promise<JsDebugStartDebuggingArgs>((resolveArgs) => {
    settleStartDebugging = resolveArgs
  })
  client.onReverseRequest((request) => {
    if (request.command !== 'startDebugging') return Promise.resolve({})
    const args = request.arguments
    if (args === undefined) return Promise.reject(new DebugError('startDebugging carried no arguments', 'DEBUG_LAUNCH_FAILED'))
    const requestVerb = args['request']
    const configuration = asRecord(args['configuration'])
    if (typeof requestVerb !== 'string' || configuration === undefined) {
      return Promise.reject(new DebugError('startDebugging carried no usable target configuration', 'DEBUG_LAUNCH_FAILED'))
    }
    settleStartDebugging?.({ request: requestVerb, configuration })
    return Promise.resolve({})
  })
  const { request: verb, ...launchArguments } = launch
  if (verb !== 'launch' && verb !== 'attach') {
    throw new DebugError(`unsupported debug request verb ${String(verb)}`, 'DEBUG_INVALID_CONFIG')
  }
  requireSuccess(await client.request('initialize', initializeArguments(), signal), 'initialize')
  await nextEvent(client, 'initialized', signal)
  requireSuccess(await client.request('configurationDone', {}, signal), 'configurationDone')
  requireSuccess(await client.request(verb, { ...launchArguments, type: JS_DEBUG_TYPE }, signal), verb)
  return await startDebugging
}

/**
 * The launch backend for js-debug's broker protocol. The adapter's root
 * connection only brokers: after its launch, the real session opens a SECOND
 * connection to the same port whose launch carries the reverse request's
 * `__pendingTargetId`, and every session event arrives on that connection.
 * @param endpoint - The announced adapter socket endpoint.
 * @param stdio - The spawned adapter's piped stdin, ended on teardown.
 * @param sessionId - The session id stamped onto backend snapshots.
 * @param capture - The first-stop observation filled on the session connection.
 * @param backendHolder - Receives the session backend once the broker hands it over.
 * @returns the orchestration-facing backend.
 */
function socketLaunchBackendOf(
  endpoint: DebugTunnelEndpoint,
  stdio: { readonly stdin: Writable; readonly stdout: Readable },
  sessionId: DebugSessionId,
  capture: FirstStopCapture,
  backendHolder: { current: DapDebugBackend | undefined },
): LaunchBackend {
  const openClients: DapClient[] = []
  return {
    async start({ launch, timeoutMs }) {
      const root = new DapClient(await connectDebugTunnel(socketConnector, endpoint))
      openClients.push(root)
      const args = await rootLaunchUntilStartDebugging(root, launch, timeoutMs)
      const session = new DapClient(await connectDebugTunnel(socketConnector, endpoint))
      openClients.push(session)
      observeFirstStop(session, capture)
      const dap = new DapDebugBackend(session, {
        sessionId,
        workspaceRoot: PACKAGE_ROOT,
        requestTimeoutMs: REQUEST_TIMEOUT_MS,
        resumeTimeoutMs: RESUME_TIMEOUT_MS,
        consoleLimit: DEFAULT_CONSOLE_LIMIT,
      })
      backendHolder.current = dap
      if (args.request !== 'launch' && args.request !== 'attach') {
        throw new DebugError(`unsupported startDebugging verb ${args.request}`, 'DEBUG_LAUNCH_FAILED')
      }
      try {
        await dap.start({ launch: { request: args.request, ...args.configuration }, timeoutMs })
      } catch (error: unknown) {
        for (const client of openClients.splice(0)) await disposeContained(client)
        throw error
      }
      await awaitFirstStop(capture, AbortSignal.timeout(timeoutMs))
      return await firstStopOutcome(dap, capture)
    },
    async setBreakpoints(request) {
      const dap = backendHolder.current
      if (dap === undefined) {
        throw new DebugError('breakpoints cannot be set before the broker hands over the session', 'DEBUG_INVALID_STATE', { sessionId })
      }
      return await dap.setBreakpoints({
        source: fixtureSource(request.source),
        breakpoints: request.breakpoints,
      })
    },
    async dispose() {
      for (const client of openClients.splice(0)) await disposeContained(client)
      if (!stdio.stdin.destroyed) stdio.stdin.end()
    },
  }
}

/** One live fixture session: the orchestration's record plus the real backend driven through the test face. */
export interface DebugE2eSession {
  /** The registered session id. */
  readonly id: DebugSessionId
  /** The record's lifecycle state, advanced by the backend. */
  readonly state: DebugSessionState
  /** The durable `debug/*` payloads the orchestration appended, in order. */
  readonly durableEvents: readonly Readonly<Record<string, JsonValue>>[]
  /**
   * Replaces one file's breakpoints on the live adapter.
   * @param request - Workspace-relative source path and requested lines.
   * @returns resolves once the adapter applied the set.
   */
  setBreakpoints(request: { readonly source: string; readonly breakpoints: readonly { readonly line: number }[] }): Promise<void>
  /**
   * Resumes the stopped thread and waits for the next stop.
   * @returns the next stop, a termination, or a still-running target.
   */
  continue(): Promise<DebugResumeResult>
  /**
   * Steps the stopped thread by one granularity.
   * @param kind - The step direction.
   * @returns the next stop, a termination, or a still-running target.
   */
  step(kind: DebugStepKind): Promise<DebugResumeResult>
  /**
   * Ends the session: terminate (when the adapter supports it), disconnect, and
   * registry removal.
   * @returns resolves once the session is torn down and unregistered.
   */
  terminate(): Promise<void>
}

/**
 * Launches one fixture program under its real provider, adapter, and the
 * shipped launch orchestration.
 *
 * Node composes the managed js-debug DAP server (socket bridge); python
 * composes the debugpy adapter over stdio with the venv provision when present.
 * Go and native are explicit skips this wave and fail loud here if reached.
 * @param language - The matrix language.
 * @param options - Fixture selection: the file is workspace-root relative.
 * @returns the live session handle over the registered backend.
 * @throws {@link DebugError} from any launch stage; the orchestration has
 *   already disposed the backend and appended the failed end event by then.
 */
export async function launchFixture(language: DebugE2eLanguage, options: { readonly file: string }): Promise<DebugE2eSession> {
  if (language === 'go' || language === 'native') {
    throw new DebugError(
      `debug e2e for ${language} is an explicit skip this wave; launchFixture supports node and python`,
      'DEBUG_ADAPTER_UNSUPPORTED',
      { providerId: DebugProviderId(language) },
    )
  }
  const matrix = MATRIX[language]
  const provider = language === 'node' ? nodeDebugProvider : pythonDebugProvider
  const context = new Context()
  const debug = new Debug(context)
  await context.plugin(LocalFileSystem)
  await context.plugin(LocalSubprocessRuntime)
  const sessionId = DebugSessionId(`debug-e2e-${Date.now().toString(16)}`)
  const capture = createFirstStopCapture()
  const durableEvents: Array<Record<string, JsonValue>> = []
  const backendHolder: { current: DapDebugBackend | undefined } = { current: undefined }

  const environment: DebugEnvironment = {
    workspaceRoot: PACKAGE_ROOT,
    cwd: PACKAGE_ROOT,
    platform: process.platform,
    arch: process.arch,
    pathSeparator: '/',
    subprocess: context.subprocess,
    fs: context.fs,
    adapters: { resolve: async () => ensureAdapter(language) },
    requiredCapabilities: matrix.capabilities,
  }

  const record = await launchDebugSession({
    request: {
      providerId: DebugProviderId(language),
      workspaceRoot: PACKAGE_ROOT,
      workspaceId: 'debug-e2e',
      cwd: PACKAGE_ROOT,
      program: options.file,
      stopOnEntry: true,
      // The interpreter that owns the debugpy install also runs the target:
      // the bare toolchain python cannot import the adapter's debugpy.
      ...(language === 'python' ? { providerOptions: { python: ensureAdapter(language).command[0] ?? 'python3' } } : {}),
      caller: { kind: 'user', sessionId: SessionId('debug-e2e-fixture') },
    },
    provider,
    environment,
    registry: debug.sessions,
    append: (type, payload) => {
      durableEvents.push({ type, ...payload })
    },
    createBackend: async (stdio) => {
      if (matrix.transport === 'socket') {
        const endpoint = await announcedEndpoint(stdio.stdout)
        // Keep draining the adapter's stdout so later log lines can never fill the pipe.
        stdio.stdout.resume()
        return socketLaunchBackendOf(endpoint, stdio, sessionId, capture, backendHolder)
      }
      const client = new DapClient(createStdioTransport(stdio))
      const dap = new DapDebugBackend(client, {
        sessionId,
        workspaceRoot: PACKAGE_ROOT,
        requestTimeoutMs: REQUEST_TIMEOUT_MS,
        resumeTimeoutMs: RESUME_TIMEOUT_MS,
        consoleLimit: DEFAULT_CONSOLE_LIMIT,
      })
      observeFirstStop(client, capture)
      backendHolder.current = dap
      return stdioLaunchBackendOf(dap, client, stdio, capture)
    },
    breakpoints: debug.breakpoints,
    requestTimeoutMs: REQUEST_TIMEOUT_MS,
  })

  const backend = backendHolder.current
  if (backend === undefined) {
    throw new DebugError('the launch completed without wiring a DAP backend', 'DEBUG_LAUNCH_FAILED', { sessionId: record.id })
  }
  const disposeBackendFace = debug.registerBackend(record.id, backend)

  const currentThread = async (): Promise<DebugThreadId> => {
    const remembered = capture.threadId
    if (remembered !== undefined) return DebugThreadId(remembered)
    const threads = await backend.threads()
    const first = threads[0]
    if (first === undefined) {
      throw new DebugError('the adapter reports no threads', 'DEBUG_SESSION_GONE', { sessionId: record.id })
    }
    return first.id
  }

  return {
    get id(): DebugSessionId {
      return record.id
    },
    get state(): DebugSessionState {
      return record.state
    },
    get durableEvents(): readonly Readonly<Record<string, JsonValue>>[] {
      return durableEvents
    },
    async setBreakpoints(request): Promise<void> {
      await backend.setBreakpoints({
        source: fixtureSource(request.source),
        breakpoints: request.breakpoints,
      })
    },
    async continue(): Promise<DebugResumeResult> {
      return await backend.continue(await currentThread())
    },
    async step(kind): Promise<DebugResumeResult> {
      return await backend.step(kind, await currentThread())
    },
    async terminate(): Promise<void> {
      try {
        await backend.terminate()
      } catch (error) {
        // Adapters without the terminate capability still end the session through disconnect.
        if (!(error instanceof DebugError) || error.code !== 'DEBUG_UNSUPPORTED_CAPABILITY') throw error
      }
      await backend.disconnect()
      await debug.sessions.remove(record.id, 'user')
      disposeBackendFace()
    },
  }
}
