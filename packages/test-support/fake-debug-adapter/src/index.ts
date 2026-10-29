/**
 * Deterministic in-memory fake Debug Adapter Protocol adapter.
 *
 * The adapter answers a client's DAP requests from fixed fixture data and a
 * script of injected conditions (stops, hangs, malformed frames, crashes,
 * delayed events, stderr text, and a `runInTerminal` reverse request), so
 * debug-client tests never depend on a real language toolchain. Message order
 * follows the protocol: every request is answered by its response first, then
 * any events the script schedules after it.
 * @module @deepseek-ai/dsh-fake-debug-adapter
 */
import { encodeDapFrame, type DapClientMessage, type DapMessage, type DapRequest, type DapResponse, type JsonRecord, type JsonValue } from './frames.ts'

export { decodeDapFrames, encodeDapFrame } from './frames.ts'
export type { DapClientMessage, DapEvent, DapFrameDecodeResult, DapMessage, DapRequest, DapResponse, JsonRecord, JsonValue } from './frames.ts'

/** One scripted stop; `reason` is echoed into the `stopped` event body. */
export interface FakeScriptedStop {
  readonly reason: string
  readonly threadId: number
  readonly line: number
  readonly column?: number
  readonly description?: string
}

/** Arguments of the injected `runInTerminal` reverse request. */
export interface FakeRunInTerminalScript {
  readonly args: readonly string[]
}

/** An event the adapter emits on a timer after its first received request. */
export interface FakeDelayedEventScript {
  readonly afterMs: number
  readonly event: string
  readonly body?: JsonRecord
}

/** Scripted conditions the adapter plays back. All fields are optional. */
export interface FakeDebugAdapterScript {
  /** Merges over the default capability flags of the `initialize` response. */
  readonly capabilities?: Readonly<Record<string, boolean>>
  /** Stops replayed one per advance; an exhausted script terminates. */
  readonly stops?: readonly FakeScriptedStop[]
  /** Commands that never receive a response. */
  readonly hang?: readonly string[]
  /** Commands answered with a scripted failure response. */
  readonly fail?: readonly string[]
  /** Commands after which one malformed wire chunk is emitted next. */
  readonly malformedAfter?: readonly string[]
  /** See {@link FakeDelayedEventScript}. */
  readonly delayedEvent?: FakeDelayedEventScript
  /** Command whose receipt crashes the adapter, discarding pending output. */
  readonly crashAfter?: string
  /** Debuggee stderr text recorded when `launch` or `attach` is processed. */
  readonly stderr?: string
  /** See {@link FakeRunInTerminalScript}. */
  readonly runInTerminal?: FakeRunInTerminalScript
}

/** Rejection used by every read after a scripted crash. */
export class FakeDebugAdapterCrashError extends Error {
  constructor() {
    super('fake debug adapter crashed per script')
    this.name = 'FakeDebugAdapterCrashError'
  }
}

/** The in-memory fake adapter. */
export interface FakeDebugAdapter {
  /** Feeds one client message (request, or response to a reverse request). */
  write(message: DapClientMessage): void
  /** Resolves with the next adapter message, skipping malformed wire chunks. */
  read(): Promise<DapMessage>
  /** Resolves with the next wire bytes, passing malformed chunks through raw. */
  readWire(): Promise<Uint8Array>
  /** Debuggee stderr recorded so far; grows when `launch`/`attach` runs. */
  readonly stderrText: string
  /** Client responses to reverse requests, in arrival order. */
  readonly reverseRequestResponses: readonly DapResponse[]
}

/**
 * Creates a deterministic in-memory fake adapter.
 *
 * @param script Injected conditions; omit it for a minimal launch-to-exit flow.
 * @returns The adapter instance.
 */
export function createFakeDebugAdapter(script: FakeDebugAdapterScript = {}): FakeDebugAdapter {
  return new ScriptedAdapter(script)
}

const DEFAULT_CAPABILITIES: Readonly<Record<string, boolean>> = {
  supportsConfigurationDoneRequest: true,
  supportsConditionalBreakpoints: true,
  supportsHitConditionalBreakpoints: true,
  supportsLogPoints: true,
  supportsFunctionBreakpoints: true,
  supportsTerminateRequest: true,
  supportsRestartRequest: true,
  supportsSetVariable: true,
  supportsEvaluateForHovers: true,
  supportsCancelRequest: true,
}

const MALFORMED_CHUNK: Uint8Array = new TextEncoder().encode('Content-Length: 4\r\n\r\noops')

const THREADS_BODY: JsonRecord = { threads: [{ id: 1, name: 'main' }] }
const SCOPES_BODY: JsonRecord = { scopes: [
  { name: 'Locals', presentationHint: 'locals', variablesReference: 2001, expensive: false },
  { name: 'Globals', presentationHint: 'globals', variablesReference: 2002, expensive: true },
] }
const VARIABLES_BY_REFERENCE: Readonly<Record<number, readonly JsonValue[]>> = {
  2001: [
    { name: 'count', value: '1', type: 'number', variablesReference: 0 },
    { name: 'items', value: 'Array(2)', type: 'array', variablesReference: 3001 },
  ],
  2002: [{ name: 'global', value: 'true', type: 'boolean', variablesReference: 0 }],
  3001: [{ name: '0', value: '"alpha"', type: 'string', variablesReference: 0 }],
}

type OutputItem = { readonly kind: 'message'; readonly message: DapMessage } | { readonly kind: 'malformed' }

interface OutputWaiter {
  readonly resolve: (item: OutputItem) => void
  readonly reject: (error: FakeDebugAdapterCrashError) => void
}

function requireArray(value: JsonValue | undefined, field: string): readonly JsonValue[] {
  if (!Array.isArray(value)) throw new Error(`fake debug adapter: ${field} must be an array`)
  return value as readonly JsonValue[]
}

function isJsonRecord(value: JsonValue): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireRecord(value: JsonValue, field: string): JsonRecord {
  if (!isJsonRecord(value)) throw new Error(`fake debug adapter: ${field} must be an object`)
  return value
}

function requireNumber(value: JsonValue | undefined, field: string): number {
  if (typeof value !== 'number') throw new Error(`fake debug adapter: ${field} must be a number`)
  return value
}

function requireString(value: JsonValue | undefined, field: string): string {
  if (typeof value !== 'string') throw new Error(`fake debug adapter: ${field} must be a string`)
  return value
}

class ScriptedAdapter implements FakeDebugAdapter {
  private readonly script: FakeDebugAdapterScript
  private readonly queue: OutputItem[] = []
  private readonly waiters: OutputWaiter[] = []
  private readonly outstandingReverseRequests = new Set<number>()
  private readonly recordedReverseResponses: DapResponse[] = []
  private nextSeq = 1
  private stopCursor = 0
  private stopEmitted = false
  private frameEpoch = 0
  private currentStop: FakeScriptedStop | undefined
  private stderrCollected = ''
  private crashed = false
  private delayedScheduled = false

  constructor(script: FakeDebugAdapterScript) {
    this.script = script
  }

  get stderrText(): string {
    return this.stderrCollected
  }

  get reverseRequestResponses(): readonly DapResponse[] {
    return this.recordedReverseResponses
  }

  write(message: DapClientMessage): void {
    if (this.crashed) return
    this.scheduleDelayedEvent()
    if (message.type === 'request') {
      this.handleRequest(message)
      return
    }
    this.handleReverseResponse(message)
  }

  async read(): Promise<DapMessage> {
    for (let item = await this.next(); ; item = await this.next()) {
      if (item.kind === 'message') return item.message
    }
  }

  async readWire(): Promise<Uint8Array> {
    const item = await this.next()
    if (item.kind === 'malformed') return MALFORMED_CHUNK
    return encodeDapFrame(item.message)
  }

  private next(): Promise<OutputItem> {
    if (this.crashed) return Promise.reject(new FakeDebugAdapterCrashError())
    const queued = this.queue.shift()
    if (queued !== undefined) return Promise.resolve(queued)
    return new Promise<OutputItem>((resolve, reject) => {
      this.waiters.push({ resolve, reject })
    })
  }

  private scheduleDelayedEvent(): void {
    if (this.delayedScheduled) return
    this.delayedScheduled = true
    const delayed = this.script.delayedEvent
    if (delayed === undefined) return
    const timer = setTimeout(() => {
      this.enqueueEvent(delayed.event, delayed.body)
    }, delayed.afterMs)
    timer.unref()
  }

  private handleRequest(request: DapRequest): void {
    if (this.script.crashAfter === request.command) {
      this.crash()
      return
    }
    if (this.script.hang?.includes(request.command)) return
    if (this.script.fail?.includes(request.command)) {
      this.enqueue({
        seq: this.nextSeq++,
        type: 'response',
        request_seq: request.seq,
        success: false,
        command: request.command,
        message: `scripted failure: ${request.command}`,
      })
      return
    }
    const args: JsonRecord = request.arguments ?? {}
    switch (request.command) {
      case 'initialize':
        this.respondOk(request, { capabilities: { ...DEFAULT_CAPABILITIES, ...this.script.capabilities } })
        this.enqueueEvent('initialized')
        break
      case 'setBreakpoints': {
        const breakpoints = requireArray(args['breakpoints'], 'setBreakpoints.breakpoints')
        this.respondOk(request, { breakpoints: breakpoints.map((entry, index) => ({
          id: 1000 + index,
          verified: true,
          line: requireNumber(requireRecord(entry, 'setBreakpoints.breakpoints[]')['line'], 'setBreakpoints.breakpoints[].line'),
        })) })
        break
      }
      case 'setFunctionBreakpoints': {
        const breakpoints = requireArray(args['breakpoints'], 'setFunctionBreakpoints.breakpoints')
        this.respondOk(request, { breakpoints: breakpoints.map((_entry, index) => ({ id: 2000 + index, verified: true })) })
        break
      }
      case 'setExceptionBreakpoints':
        this.respondOk(request, {})
        break
      case 'configurationDone':
        this.respondOk(request, {})
        if ((this.script.stops?.length ?? 0) > 0 && !this.stopEmitted) this.advance()
        break
      case 'launch':
      case 'attach': {
        this.respondOk(request, {})
        if (this.script.runInTerminal !== undefined) {
          this.outstandingReverseRequests.add(this.nextSeq)
          this.enqueue({
            seq: this.nextSeq++,
            type: 'request',
            command: 'runInTerminal',
            arguments: { kind: 'integrated', title: 'fake terminal', cwd: '/ws', args: this.script.runInTerminal.args },
          })
        }
        this.enqueueEvent('process', {
          name: 'fake-debuggee',
          systemProcessId: 4242,
          isLocalProcess: true,
          startMethod: request.command === 'attach' ? 'attach' : 'launch',
        })
        if (!this.stopEmitted) this.advance()
        if (this.script.stderr !== undefined) this.stderrCollected += this.script.stderr
        break
      }
      case 'threads':
        this.respondOk(request, THREADS_BODY)
        break
      case 'stackTrace': {
        const stop = this.currentStop
        this.respondOk(request, { stackFrames: [{
          id: 999 + Math.max(this.frameEpoch, 1),
          name: 'fake frame',
          source: { path: '/ws/a.ts', name: 'a.ts' },
          line: stop?.line ?? 1,
          column: stop?.column ?? 1,
        }], totalFrames: 1 })
        break
      }
      case 'scopes':
        this.respondOk(request, SCOPES_BODY)
        break
      case 'variables': {
        const reference = requireNumber(args['variablesReference'], 'variables.variablesReference')
        this.respondOk(request, { variables: VARIABLES_BY_REFERENCE[reference] ?? [] })
        break
      }
      case 'evaluate':
        this.respondOk(request, {
          result: `eval:${requireString(args['expression'], 'evaluate.expression')}`,
          type: 'string',
          variablesReference: 0,
        })
        break
      case 'continue':
      case 'next':
      case 'stepIn':
      case 'stepOut':
      case 'stepBack':
        this.respondOk(request, request.command === 'continue' ? { allThreadsContinued: false } : {})
        this.advance()
        break
      case 'pause':
        this.respondOk(request, {})
        this.enqueueEvent('stopped', { reason: 'pause', threadId: 1, line: 1, column: 1, description: '', text: '' })
        break
      case 'restart':
        this.respondOk(request, {})
        this.enqueueEvent('process', { name: 'fake-debuggee', systemProcessId: 4242, isLocalProcess: true, startMethod: 'launch' })
        this.stopCursor = 0
        this.stopEmitted = false
        this.frameEpoch = 0
        this.advance()
        break
      case 'terminate':
        this.respondOk(request, {})
        this.enqueueEvent('terminated')
        break
      case 'disconnect':
        this.respondOk(request, {})
        break
      case 'cancel':
        this.respondOk(request, {})
        break
      default:
        this.enqueue({
          seq: this.nextSeq++,
          type: 'response',
          request_seq: request.seq,
          success: false,
          command: request.command,
          message: `unsupported command: ${request.command}`,
        })
    }
    if (this.script.malformedAfter?.includes(request.command)) this.enqueueMalformed()
  }

  private handleReverseResponse(message: DapResponse): void {
    if (this.outstandingReverseRequests.delete(message.request_seq)) {
      this.recordedReverseResponses.push(message)
    }
  }

  private advance(): void {
    const stop = (this.script.stops ?? [])[this.stopCursor]
    this.frameEpoch += 1
    if (stop === undefined) {
      this.enqueueEvent('terminated')
      return
    }
    this.stopCursor += 1
    this.stopEmitted = true
    this.currentStop = stop
    this.enqueueEvent('stopped', {
      reason: stop.reason,
      threadId: stop.threadId,
      line: stop.line,
      column: stop.column ?? 1,
      description: stop.description ?? '',
      text: '',
    })
  }

  private respondOk(request: DapRequest, body: JsonRecord): void {
    this.enqueue({ seq: this.nextSeq++, type: 'response', request_seq: request.seq, success: true, command: request.command, body })
  }

  private enqueueEvent(event: string, body?: JsonRecord): void {
    this.enqueue({ seq: this.nextSeq++, type: 'event', event, ...(body === undefined ? {} : { body }) })
  }

  private enqueueMalformed(): void {
    this.enqueueItem({ kind: 'malformed' })
  }

  private enqueue(message: DapMessage): void {
    this.enqueueItem({ kind: 'message', message })
  }

  private enqueueItem(item: OutputItem): void {
    const waiter = this.waiters.shift()
    if (waiter === undefined) {
      this.queue.push(item)
      return
    }
    waiter.resolve(item)
  }

  private crash(): void {
    this.crashed = true
    this.queue.length = 0
    for (const waiter of this.waiters.splice(0)) waiter.reject(new FakeDebugAdapterCrashError())
  }
}
