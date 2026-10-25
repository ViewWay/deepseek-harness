/**
 * Request/response client for one DAP adapter connection.
 *
 * The client owns the wire mechanics only: sequence numbers, pending-request
 * correlation, per-request abort, event fan-out, reverse-request dispatch, and
 * terminal failure states. It resolves every well-formed adapter response —
 * including `success: false` — so policy (which failures mean what) stays with
 * the handshake and backend layers. Abort surfaces as `DEBUG_TIMEOUT`;
 * adapter exit, disposal, and send failures surface as `DEBUG_SESSION_GONE`;
 * malformed frames and unmatched responses kill the client with
 * `DEBUG_MALFORMED_RESPONSE`.
 * @module @deepseek-ai/dsh-debug-dap/client
 */
import { DebugError } from '@deepseek-ai/dsh-debug'
import { decodeDapFrames, encodeDapFrame, MAX_MESSAGE_BYTES, type DapArguments, type DapEvent, type DapFrameDecoding, type DapMessage, type DapRequest, type DapResponse } from './frames.ts'
import type { DebugTransport as Transport } from './transport.ts'

/** Listener for adapter events. */
export type DapEventListener = (event: DapEvent) => void

/** Handler answering an adapter-initiated reverse request. */
export type DapReverseRequestHandler = (request: DapRequest) => Promise<DapArguments>

interface PendingRequest {
  readonly requestSeq: number
  settle(response: DapResponse): void
  fail(error: DebugError): void
  cleanup(): void
}

const CLOSED = Symbol('dap-client-closed')

/**
 * Correlates DAP requests with responses over one transport.
 *
 * The reader loop starts on construction and ends on transport end, malformed
 * input, or {@link DapClient.dispose}; after either, new requests reject with
 * the matching terminal failure.
 */
export class DapClient {
  readonly transport: Transport
  private readonly closed: Promise<void>
  private readonly resolveClosed: () => void
  private readonly pending = new Map<number, PendingRequest>()
  private readonly eventListeners = new Set<DapEventListener>()
  private reverseHandler: DapReverseRequestHandler | undefined
  private sequence = 0
  private rest: Uint8Array = new Uint8Array(0)
  private deadError: DebugError | undefined
  private ended = false
  private disposed = false

  /**
   * @param transport Byte transport wired to the adapter.
   */
  constructor(transport: Transport) {
    this.transport = transport
    let resolveClosed!: () => void
    this.closed = new Promise<void>((resolve) => {
      resolveClosed = resolve
    })
    this.resolveClosed = resolveClosed
    void this.readLoop()
  }

  /**
   * Sends one request and resolves with the adapter's response.
   *
   * @param command DAP command name.
   * @param arguments Command-specific arguments, when the command takes any.
   * @param signal Aborts the request with `DEBUG_TIMEOUT`; callers build it
   *   from their configured timeouts (for example `AbortSignal.timeout`).
   * @returns The adapter's response, including `success: false` responses.
   * @throws DebugError(`DEBUG_TIMEOUT`) on abort;
   *   DebugError(`DEBUG_SESSION_GONE`) when disposed, ended, or the send
   *   fails; DebugError(`DEBUG_MALFORMED_RESPONSE`) once the client is dead.
   */
  async request(command: string, arguments_?: DapArguments, signal?: AbortSignal): Promise<DapResponse> {
    if (this.deadError !== undefined) return Promise.reject(this.deadError)
    if (this.ended) return Promise.reject(new DebugError('debug adapter output has ended', 'DEBUG_SESSION_GONE'))
    if (this.disposed) return Promise.reject(new DebugError('debug client is disposed', 'DEBUG_SESSION_GONE'))
    const requestSeq = ++this.sequence
    const { entry, promise } = this.createPending(command, requestSeq, signal)
    this.pending.set(requestSeq, entry)
    try {
      await this.transport.write(encodeDapFrame({
        seq: requestSeq,
        type: 'request',
        command,
        ...(arguments_ === undefined ? {} : { arguments: arguments_ }),
      }))
    } catch {
      this.pending.delete(requestSeq)
      entry.fail(new DebugError(`failed to send DAP request ${command}`, 'DEBUG_SESSION_GONE'))
    }
    return promise
  }

  /**
   * Subscribes to adapter events.
   *
   * @param listener Called for every event; throwing listeners are contained
   *   and never interrupt delivery to other listeners.
   * @returns Disposer removing the listener.
   */
  onEvent(listener: DapEventListener): () => void {
    this.eventListeners.add(listener)
    return () => {
      this.eventListeners.delete(listener)
    }
  }

  /**
   * Registers the handler for adapter-initiated reverse requests; reverse
   * requests that arrive without a handler are answered with an unsupported
   * failure so the adapter never hangs.
   *
   * @param handler Answers one reverse request; resolves with the response
   *   body or rejects to answer with a failure.
   * @returns Disposer removing the handler.
   */
  onReverseRequest(handler: DapReverseRequestHandler): () => void {
    this.reverseHandler = handler
    return () => {
      this.reverseHandler = undefined
    }
  }

  /**
   * Stops the reader loop, fails every pending request with
   * `DEBUG_SESSION_GONE`, and half-closes the transport. Idempotent.
   */
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.resolveClosed()
    this.failPending(new DebugError('debug client disposed', 'DEBUG_SESSION_GONE'))
    await this.transport.end()
  }

  private createPending(
    command: string,
    requestSeq: number,
    signal: AbortSignal | undefined,
  ): { readonly entry: PendingRequest; readonly promise: Promise<DapResponse> } {
    let settleResponse!: (response: DapResponse) => void
    let rejectResponse!: (error: DebugError) => void
    const response = new Promise<DapResponse>((resolve, reject) => {
      settleResponse = resolve
      rejectResponse = reject
    })
    let onAbort: (() => void) | undefined
    const entry: PendingRequest = {
      requestSeq,
      cleanup() {
        if (onAbort !== undefined) signal?.removeEventListener('abort', onAbort)
      },
      settle(received: DapResponse) {
        this.cleanup()
        settleResponse(received)
      },
      fail(error: DebugError) {
        this.cleanup()
        rejectResponse(error)
      },
    }
    if (signal !== undefined) {
      onAbort = () => {
        this.pending.delete(requestSeq)
        entry.fail(new DebugError(`DAP request ${command} was aborted`, 'DEBUG_TIMEOUT'))
      }
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }
    return { entry, promise: response }
  }

  private async readLoop(): Promise<void> {
    const iterator = this.transport.input[Symbol.asyncIterator]()
    try {
      for (;;) {
        const next = iterator.next()
        next.catch(() => {
          // Abandoned after dispose or death; the losing promise must not
          // surface as an unhandled rejection.
        })
        const winner = await Promise.race([next, this.closed.then((): typeof CLOSED => CLOSED)])
        if (winner === CLOSED) break
        if (winner.done) {
          this.ended = true
          this.failPending(new DebugError('debug adapter output ended', 'DEBUG_SESSION_GONE'))
          break
        }
        this.consumeChunk(winner.value)
        if (this.deadError !== undefined) break
      }
    } catch {
      this.ended = true
      this.failPending(new DebugError('debug adapter transport failed', 'DEBUG_SESSION_GONE'))
    }
    void Promise.resolve(iterator.return?.()).catch(() => {
      // Tearing down a failing stream; the failure is already reported.
    })
  }

  private consumeChunk(chunk: Uint8Array): void {
    let decoding: DapFrameDecoding
    try {
      decoding = decodeDapFrames(this.concatRest(chunk))
    } catch {
      this.die(new DebugError('malformed DAP frame', 'DEBUG_MALFORMED_RESPONSE'))
      return
    }
    this.rest = decoding.rest
    if (this.rest.length > MAX_MESSAGE_BYTES) {
      this.die(new DebugError(`DAP frame header exceeds the ${MAX_MESSAGE_BYTES}-byte budget`, 'DEBUG_MALFORMED_RESPONSE'))
      return
    }
    for (const message of decoding.messages) this.dispatch(message)
  }

  private concatRest(chunk: Uint8Array): Uint8Array {
    if (this.rest.length === 0) return chunk
    const combined = new Uint8Array(this.rest.length + chunk.length)
    combined.set(this.rest)
    combined.set(chunk, this.rest.length)
    return combined
  }

  private dispatch(message: DapMessage): void {
    if (message.type === 'response') {
      this.settleResponse(message)
      return
    }
    if (message.type === 'event') {
      this.deliverEvent(message)
      return
    }
    void this.handleReverseRequest(message).catch(() => {
      // The transport failed while answering; the reader loop owns reporting.
    })
  }

  private settleResponse(response: DapResponse): void {
    const entry = this.pending.get(response.request_seq)
    if (entry === undefined) {
      this.die(new DebugError(
        `DAP response matched no pending request: ${response.command} #${response.request_seq}`,
        'DEBUG_MALFORMED_RESPONSE',
      ))
      return
    }
    this.pending.delete(response.request_seq)
    entry.settle(response)
  }

  private deliverEvent(event: DapEvent): void {
    for (const listener of [...this.eventListeners]) {
      try {
        listener(event)
      } catch {
        // A throwing listener must not interrupt delivery to the others.
      }
    }
  }

  private async handleReverseRequest(request: DapRequest): Promise<void> {
    const handler = this.reverseHandler
    if (handler === undefined) {
      await this.answerReverseRequest(request, false, undefined, 'unsupported reverse request')
      return
    }
    try {
      const body = await handler(request)
      await this.answerReverseRequest(request, true, body, undefined)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'reverse request handler failed'
      await this.answerReverseRequest(request, false, undefined, message)
    }
  }

  private async answerReverseRequest(
    request: DapRequest,
    success: boolean,
    body: DapArguments | undefined,
    failureMessage: string | undefined,
  ): Promise<void> {
    await this.transport.write(encodeDapFrame({
      seq: ++this.sequence,
      type: 'response',
      request_seq: request.seq,
      success,
      command: request.command,
      ...(body === undefined ? {} : { body }),
      ...(failureMessage === undefined ? {} : { message: failureMessage }),
    }))
  }

  private die(error: DebugError): void {
    this.deadError = error
    this.resolveClosed()
    this.failPending(error)
  }

  private failPending(error: DebugError): void {
    for (const entry of [...this.pending.values()]) {
      this.pending.delete(entry.requestSeq)
      entry.fail(error)
    }
  }
}
