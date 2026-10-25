/**
 * The DAP session handshake: initialize, configuration, launch, and the first
 * stop, in the exact order the specification prescribes.
 *
 * Sequence: send `initialize` (declaring line/column/path conventions and the
 * client's reverse-request support), wait for the `initialized` event, send
 * `setBreakpoints`/`setExceptionBreakpoints`, send `configurationDone` only
 * when the adapter's raw `initialize` response declared it, then `launch` or
 * `attach`, and resolve with
 * the normalized capabilities plus the first `stopped` event — or no stop when
 * the adapter reports `terminated` first.
 * @module @deepseek-ai/dsh-debug-dap/handshake
 */
import { DebugError, DebugThreadId } from '@deepseek-ai/dsh-debug'
import type { DebugCapabilities, DebugStopSnapshot, JsonValue } from '@deepseek-ai/dsh-debug'
import { mapCapabilities, isJsonObject } from './capabilities.ts'
import type { DapArguments, DapEvent, DapResponse } from './frames.ts'
import type { DapClient } from './client.ts'

/** One breakpoint group to configure before launch. */
export interface DebugHandshakeBreakpoints {
  /** Workspace-relative or absolute source path, as the adapter expects it. */
  readonly source: string
  /** Lines to break on. */
  readonly lines: readonly number[]
}

/** What the handshake configures and launches. */
export interface DebugHandshakePlan {
  /** Adapter arguments in effect, retained for diagnostics only. */
  readonly adapterArgs?: readonly string[]
  /** DAP `launch`/`attach` arguments; `request` selects the verb. */
  readonly launch: { readonly request: 'launch' | 'attach' } & DapArguments
  /** Breakpoint groups sent as `setBreakpoints` before configurationDone. */
  readonly breakpoints?: readonly DebugHandshakeBreakpoints[]
  /** Exception filter ids sent as `setExceptionBreakpoints`. */
  readonly exceptionFilters?: readonly string[]
  /** Whole-handshake timeout; aborts surface as `DEBUG_TIMEOUT`. */
  readonly timeoutMs: number
}

/** Adapter-level stop fact; the session backend attaches identity and frames. */
export interface DebugAdapterStop {
  readonly reason: DebugStopSnapshot['reason']
  readonly threadId: DebugThreadId
  readonly description?: string
}

/** Outcome of a completed handshake. */
export interface DebugHandshakeResult {
  readonly capabilities: DebugCapabilities
  /** First `stopped` event, or undefined when the adapter terminated first. */
  readonly firstStop: DebugAdapterStop | undefined
}

const STOP_REASONS: Readonly<Record<string, DebugStopSnapshot['reason']>> = {
  breakpoint: 'breakpoint',
  step: 'step',
  pause: 'pause',
  entry: 'entry',
  exception: 'exception',
  'data breakpoint': 'dataBreakpoint',
  'instruction breakpoint': 'instructionBreakpoint',
  restart: 'restart',
}

/**
 * Normalizes a DAP `stopped` reason onto the seam's closed reason union.
 *
 * @param reason The event's `reason` field, when present.
 * @returns The mapped reason; `unknown` for absent or unmapped values.
 */
export function mapStopReason(reason: JsonValue | undefined): DebugStopSnapshot['reason'] {
  if (typeof reason !== 'string') return 'unknown'
  return STOP_REASONS[reason] ?? 'unknown'
}

/**
 * Runs the initialize-configure-launch handshake to the first stop.
 *
 * @param client Client wired to the adapter.
 * @param plan Configuration, launch arguments, and timeout.
 * @returns Normalized capabilities and the first stop, if one happened.
 * @throws DebugError(`DEBUG_INVALID_CONFIG`) when `timeoutMs` is not
 *   positive; DebugError(`DEBUG_LAUNCH_FAILED`) when the adapter rejects
 *   `initialize`, `launch`, or `attach`; DebugError(`DEBUG_TIMEOUT`) when
 *   the plan's timeout elapses at any stage.
 */
export async function initializeDebugAdapter(client: DapClient, plan: DebugHandshakePlan): Promise<DebugHandshakeResult> {
  if (plan.timeoutMs <= 0) {
    throw new DebugError(`handshake timeoutMs must be positive, got ${plan.timeoutMs}`, 'DEBUG_INVALID_CONFIG')
  }
  const signal = AbortSignal.timeout(plan.timeoutMs)
  const initialized = eventWait(client, 'initialized', signal)
  const firstStop = stopWait(client, signal)
  void initialized.catch(() => {
    // A later stage already rejected; this waiter must not surface as unhandled.
  })
  void firstStop.catch(() => {
    // Same containment for the stop waiter.
  })

  const initializeResponse = await client.request('initialize', {
    clientID: 'dsh',
    adapterID: 'dsh',
    linesStartAt1: true,
    columnsStartAt1: true,
    pathFormat: 'path',
    supportsRunInTerminalRequest: true,
    supportsStartDebuggingRequest: true,
  }, signal)
  requireSuccess(initializeResponse, 'initialize')
  const rawCapabilities = capabilitiesOf(initializeResponse)
  const capabilities = mapCapabilities(rawCapabilities)
  await initialized

  for (const group of plan.breakpoints ?? []) {
    await client.request('setBreakpoints', {
      source: { path: group.source },
      breakpoints: group.lines.map(line => ({ line })),
    }, signal)
  }
  if (plan.exceptionFilters !== undefined) {
    await client.request('setExceptionBreakpoints', { filters: plan.exceptionFilters }, signal)
  }
  if (isJsonObject(rawCapabilities) && rawCapabilities['supportsConfigurationDoneRequest'] === true) {
    await client.request('configurationDone', {}, signal)
  }

  const { request: verb, ...launchArguments } = plan.launch
  const launchResponse = await client.request(verb, launchArguments, signal)
  requireSuccess(launchResponse, verb)

  return { capabilities, firstStop: await firstStop }
}

function requireSuccess(response: DapResponse, command: string): void {
  if (response.success) return
  const detail = typeof response.message === 'string' ? response.message : 'no detail'
  throw new DebugError(`adapter rejected ${command}: ${detail}`, 'DEBUG_LAUNCH_FAILED')
}

function capabilitiesOf(response: DapResponse): JsonValue | undefined {
  if (!isJsonObject(response.body)) return undefined
  return response.body['capabilities']
}

function eventWait(client: DapClient, event: string, signal: AbortSignal): Promise<DapEvent> {
  return new Promise<DapEvent>((resolve, reject) => {
    const dispose = client.onEvent((received) => {
      if (received.event !== event) return
      dispose()
      resolve(received)
    })
    onAbort(signal, reject)
  })
}

function stopWait(client: DapClient, signal: AbortSignal): Promise<DebugAdapterStop | undefined> {
  return new Promise<DebugAdapterStop | undefined>((resolve, reject) => {
    const dispose = client.onEvent((received) => {
      if (received.event === 'stopped') {
        dispose()
        const outcome = stopOf(received)
        if (outcome instanceof DebugError) {
          reject(outcome)
          return
        }
        resolve(outcome)
        return
      }
      if (received.event === 'terminated') {
        dispose()
        resolve(undefined)
      }
    })
    onAbort(signal, reject)
  })
}

function stopOf(event: DapEvent): DebugAdapterStop | DebugError {
  const body = isJsonObject(event.body) ? event.body : {}
  const threadId = body['threadId']
  if (typeof threadId !== 'number') {
    return new DebugError('stopped event without a numeric threadId', 'DEBUG_MALFORMED_RESPONSE')
  }
  const description = body['description']
  return {
    reason: mapStopReason(body['reason']),
    threadId: DebugThreadId(String(threadId)),
    ...(typeof description === 'string' && description !== '' ? { description } : {}),
  }
}

function onAbort(signal: AbortSignal, reject: (error: DebugError) => void): void {
  signal.addEventListener('abort', () => {
    reject(new DebugError('debug adapter handshake timed out', 'DEBUG_TIMEOUT'))
  }, { once: true })
}
