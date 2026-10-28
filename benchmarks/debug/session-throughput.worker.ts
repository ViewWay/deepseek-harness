/** Debug session throughput: one backend over a scripted wire replays 10k console lines and serves paged inspection through repeated stop/continue cycles. */
import { performance } from 'node:perf_hooks'
import { DebugFrameId, DebugSessionId, DebugThreadId, DebugVariableReference } from '@deepseek-ai/dsh-debug'
import type { JsonValue } from '@deepseek-ai/dsh-debug'
import { DapClient, DapDebugBackend, decodeDapFrames, encodeDapFrame } from '@deepseek-ai/dsh-debug-dap'
import type { DapEvent, DapRequest, DapResponse } from '@deepseek-ai/dsh-debug-dap'
import { assertBuiltBenchmarkRuntime } from '../support/built-worker.ts'

const CONSOLE_LIMIT = 128

/** One fresh-session sample; retained heap covers the live backend after the final cycle. */
export interface DebugThroughputReport {
  readonly consoleLines: number
  readonly stopCycles: number
  readonly page: number
  readonly ingestMs: number
  readonly cyclesMs: number
  readonly retainedHeapBytes: number
  readonly ringEntries: number
  readonly stackPageFrames: number
  readonly variablesPageSize: number
  readonly ringAtCap: boolean
}

const FRAMES: readonly JsonValue[] = Array.from({ length: 10_000 }, (_, index) => ({
  id: index, name: `frame-${index}`, line: index + 1, column: 1,
}))
const VARIABLES: readonly JsonValue[] = Array.from({ length: 10_000 }, (_, index) => ({
  name: `v${index}`, value: String(index), type: 'number', variablesReference: 0,
}))

/**
 * Drive the production backend through the scripted wire.
 * @param consoleLines - console lines the launch replays.
 * @param stopCycles - stop/continue cycles to run.
 * @param page - requested stack and variable page size.
 * @returns the measured sample.
 */
async function measure(consoleLines: number, stopCycles: number, page: number): Promise<DebugThroughputReport> {
  const waiters: { resolve: (result: IteratorResult<Uint8Array>) => void }[] = []
  const queued: IteratorResult<Uint8Array>[] = []
  let wireSeq = 1
  let stopsLeft = stopCycles
  const deliver = (message: DapResponse | DapEvent): void => {
    const bytes = encodeDapFrame(message)
    const waiter = waiters.shift()
    if (waiter === undefined) queued.push({ done: false, value: bytes })
    else waiter.resolve({ done: false, value: bytes })
  }
  const respond = (request: DapRequest, body: JsonValue): void => {
    deliver({ seq: wireSeq++, type: 'response', request_seq: request.seq, success: true, command: request.command, body })
  }
  const transport = {
    input: {
      [Symbol.asyncIterator]() {
        return {
          next() {
            const ready = queued.shift()
            if (ready !== undefined) return Promise.resolve(ready)
            return new Promise<IteratorResult<Uint8Array>>((resolve) => {
              waiters.push({ resolve })
            })
          },
        }
      },
    },
    async write(bytes: Uint8Array) {
      for (const message of decodeDapFrames(bytes).messages) {
        if (message.type !== 'request') continue
        const request: DapRequest = message
        const args = (request.arguments ?? {}) as Record<string, JsonValue | undefined>
        switch (request.command) {
          case 'initialize':
            respond(request, { capabilities: {} })
            deliver({ seq: wireSeq++, type: 'event', event: 'initialized' })
            break
          case 'launch': {
            respond(request, {})
            for (let index = 0; index < consoleLines; index += 1) {
              deliver({ seq: wireSeq++, type: 'event', event: 'output', body: { category: 'stdout', output: `line-${index}` } })
            }
            deliver({ seq: wireSeq++, type: 'event', event: 'stopped', body: { reason: 'breakpoint', threadId: 1 } })
            break
          }
          case 'threads':
            respond(request, { threads: [{ id: 1, name: 'main' }] })
            break
          case 'stackTrace': {
            const start = typeof args['startFrame'] === 'number' ? args['startFrame'] : 0
            const levels = typeof args['levels'] === 'number' ? args['levels'] : FRAMES.length
            respond(request, { stackFrames: FRAMES.slice(start, start + levels), totalFrames: FRAMES.length })
            break
          }
          case 'scopes':
            respond(request, { scopes: [{ name: 'Locals', variablesReference: 2001, expensive: false }] })
            break
          case 'variables': {
            const start = typeof args['start'] === 'number' ? args['start'] : 0
            const count = typeof args['count'] === 'number' ? args['count'] : VARIABLES.length
            respond(request, { variables: VARIABLES.slice(start, start + count) })
            break
          }
          case 'continue':
            respond(request, { allThreadsContinued: false })
            stopsLeft -= 1
            deliver(stopsLeft > 0
              ? { seq: wireSeq++, type: 'event', event: 'stopped', body: { reason: 'breakpoint', threadId: 1 } }
              : { seq: wireSeq++, type: 'event', event: 'terminated' })
            break
          default:
            respond(request, {})
        }
      }
    },
    async end() {},
  }
  const backend = new DapDebugBackend(new DapClient(transport), {
    sessionId: DebugSessionId('debug-0000000000000009'),
    workspaceRoot: '/ws',
    requestTimeoutMs: 30_000,
    resumeTimeoutMs: 30_000,
    consoleLimit: CONSOLE_LIMIT,
  })
  global.gc?.()
  const heapBefore = process.memoryUsage().heapUsed
  const ingestStart = performance.now()
  await backend.start({ launch: { request: 'launch' }, timeoutMs: 30_000 })
  const ingestMs = performance.now() - ingestStart
  const cyclesStart = performance.now()
  let ringEntries = 0
  let stackPageFrames = 0
  let variablesPageSize = 0
  for (let cycle = 0; cycle < stopCycles; cycle += 1) {
    const thread = (await backend.threads())[0]?.id ?? DebugThreadId('1')
    const trace = await backend.stackTrace(thread, { startFrame: 0, levels: page })
    stackPageFrames = trace.frames.length
    const frameId = trace.frames[0]?.id ?? DebugFrameId('0')
    const scopes = await backend.scopes(frameId)
    const reference = scopes[0]?.variablesReference ?? DebugVariableReference('2001')
    const variables = await backend.variables(reference, { start: 0, count: page })
    variablesPageSize = variables.variables.length
    const ring = await backend.console({ limit: CONSOLE_LIMIT })
    ringEntries = ring.entries.length
    await backend.continue()
  }
  const cyclesMs = performance.now() - cyclesStart
  global.gc?.()
  return {
    consoleLines, stopCycles, page, ingestMs, cyclesMs,
    retainedHeapBytes: process.memoryUsage().heapUsed - heapBefore,
    ringEntries, stackPageFrames, variablesPageSize,
    ringAtCap: ringEntries === CONSOLE_LIMIT && stackPageFrames === page && variablesPageSize === page,
  }
}

assertBuiltBenchmarkRuntime(import.meta.url, {
  '@deepseek-ai/dsh-debug': import.meta.resolve('@deepseek-ai/dsh-debug'),
  '@deepseek-ai/dsh-debug-dap': import.meta.resolve('@deepseek-ai/dsh-debug-dap'),
})
const consoleLines = Number(process.argv[2] ?? 10_000)
const stopCycles = Number(process.argv[3] ?? 25)
const page = Number(process.argv[4] ?? 20)
if (!Number.isInteger(consoleLines) || !Number.isInteger(stopCycles) || !Number.isInteger(page)
  || consoleLines < 1 || stopCycles < 1 || page < 1) {
  throw new Error('usage: session-throughput.worker.js <consoleLines> <stopCycles> <page>')
}
const report = await measure(consoleLines, stopCycles, page)
if (!report.ringAtCap) throw new Error('bounded endpoints did not hold their caps')
console.log(JSON.stringify(report))
