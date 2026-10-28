/**
 * Volume bounds: repeated stop/continue cycles over 10k console lines and
 * 10k-frame/variable wire pages keep the console ring at its configured cap,
 * stack and variable pages inside their requested windows, and the cursor
 * arithmetic monotone — no surface retains an unbounded array.
 */
import { describe, expect, it } from 'vitest'
import { DebugFrameId, DebugSessionId, DebugThreadId, DebugVariableReference } from '@deepseek-ai/dsh-debug'
import type { JsonValue } from '@deepseek-ai/dsh-debug'
import { DapClient } from '../src/client.ts'
import { decodeDapFrames, encodeDapFrame, type DapEvent, type DapRequest, type DapResponse } from '../src/frames.ts'
import type { DebugTransport } from '../src/transport.ts'
import { DapDebugBackend } from '../src/backend.ts'

const VOLUME = 10_000
const CONSOLE_LIMIT = 128
const STOP_CYCLES = 25
const PAGE = 20

const FRAMES: readonly JsonValue[] = Array.from({ length: VOLUME }, (_, index) => ({
  id: index, name: `frame-${index}`, line: index + 1, column: 1,
}))
const VARIABLES: readonly JsonValue[] = Array.from({ length: VOLUME }, (_, index) => ({
  name: `v${index}`, value: String(index), type: 'number', variablesReference: 0,
}))

/**
 * Mount one backend over a volume adapter: launch replays VOLUME console
 * lines, `stackTrace`/`variables` serve their 10k tables inside the caller's
 * window, and each `continue` lands the next scripted stop (the last one
 * terminates).
 * @returns the started backend and the commands the wire carried.
 */
async function mountVolumeBackend(): Promise<{ backend: DapDebugBackend; sentCommands: readonly string[] }> {
  const sentCommands: string[] = []
  const waiters: { resolve: (result: IteratorResult<Uint8Array>) => void }[] = []
  const queued: IteratorResult<Uint8Array>[] = []
  let wireSeq = 1
  let stopsLeft = STOP_CYCLES
  const deliver = (message: DapResponse | DapEvent): void => {
    const bytes = encodeDapFrame(message)
    const waiter = waiters.shift()
    if (waiter === undefined) queued.push({ done: false, value: bytes })
    else waiter.resolve({ done: false, value: bytes })
  }
  const respond = (request: DapRequest, body: JsonValue): void => {
    deliver({ seq: wireSeq++, type: 'response', request_seq: request.seq, success: true, command: request.command, body })
  }
  const transport: DebugTransport = {
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
        sentCommands.push(request.command)
        const args = (request.arguments ?? {}) as Record<string, JsonValue | undefined>
        switch (request.command) {
          case 'initialize':
            respond(request, { capabilities: {} })
            deliver({ seq: wireSeq++, type: 'event', event: 'initialized' })
            break
          case 'launch': {
            respond(request, {})
            for (let index = 0; index < VOLUME; index += 1) {
              deliver({ seq: wireSeq++, type: 'event', event: 'output', body: { category: 'stdout', output: `line-${index}` } })
            }
            deliver({ seq: wireSeq++, type: 'event', event: 'stopped', body: { reason: 'breakpoint', threadId: 1 } })
            break
          }
          case 'stackTrace': {
            const start = typeof args['startFrame'] === 'number' ? args['startFrame'] : 0
            const levels = typeof args['levels'] === 'number' ? args['levels'] : VOLUME
            respond(request, { stackFrames: FRAMES.slice(start, start + levels), totalFrames: VOLUME })
            break
          }
          case 'scopes':
            respond(request, { scopes: [{ name: 'Locals', variablesReference: 2001, expensive: false }] })
            break
          case 'variables': {
            const start = typeof args['start'] === 'number' ? args['start'] : 0
            const count = typeof args['count'] === 'number' ? args['count'] : VOLUME
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
    sessionId: DebugSessionId('debug-0000000000000003'),
    workspaceRoot: '/ws',
    requestTimeoutMs: 5_000,
    resumeTimeoutMs: 5_000,
    consoleLimit: CONSOLE_LIMIT,
  })
  await backend.start({ launch: { request: 'launch' }, timeoutMs: 5_000 })
  return { backend, sentCommands }
}

describe('debug backend volume bounds', () => {
  it('keeps every ring and page at its cap through repeated stop/continue cycles', async () => {
    const { backend } = await mountVolumeBackend()
    const thread = DebugThreadId('1')
    for (let cycle = 0; cycle < STOP_CYCLES; cycle += 1) {
      const trace = await backend.stackTrace(thread, { startFrame: 0, levels: PAGE })
      expect(trace.frames).toHaveLength(PAGE)
      expect(trace.totalFrames).toBe(VOLUME)
      expect(trace.truncated).toBe(true)
      expect(trace.frames[0]).toMatchObject({ id: DebugFrameId('0'), name: 'frame-0' })

      const deep = await backend.stackTrace(thread, { startFrame: VOLUME - PAGE, levels: PAGE })
      expect(deep.frames).toHaveLength(PAGE)
      expect(deep.frames[PAGE - 1]).toMatchObject({ id: DebugFrameId(String(VOLUME - 1)) })

      const scopes = await backend.scopes(trace.frames[0]?.id ?? DebugFrameId('0'))
      const reference = scopes[0]?.variablesReference ?? DebugVariableReference('2001')
      const page = await backend.variables(reference, { start: 0, count: PAGE })
      expect(page.variables).toHaveLength(PAGE)
      expect(page.variables[PAGE - 1]).toMatchObject({ name: `v${PAGE - 1}` })

      const deepPage = await backend.variables(reference, { start: VOLUME - PAGE, count: PAGE })
      expect(deepPage.variables).toHaveLength(PAGE)
      expect(deepPage.variables[0]).toMatchObject({ name: `v${VOLUME - PAGE}` })

      const ring = await backend.console({ limit: CONSOLE_LIMIT })
      expect(ring.entries).toHaveLength(CONSOLE_LIMIT)
      expect(ring.entries[0]).toMatchObject({ output: `line-${VOLUME - CONSOLE_LIMIT}` })
      expect(ring.entries[CONSOLE_LIMIT - 1]).toMatchObject({ output: `line-${VOLUME - 1}` })
      expect(ring.truncated).toBe(false)

      const wholeRing = await backend.console()
      expect(wholeRing.entries).toHaveLength(CONSOLE_LIMIT)

      const outcome = cycle === STOP_CYCLES - 1
        ? await backend.continue()
        : (await backend.continue()).kind
      if (cycle === STOP_CYCLES - 1) {
        expect(outcome).toMatchObject({ kind: 'terminated' })
      } else {
        expect(outcome).toBe('stopped')
      }
    }
  })
})
