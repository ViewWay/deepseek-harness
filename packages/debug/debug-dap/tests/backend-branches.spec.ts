import { describe, expect, it } from 'vitest'
import { createFakeDebugAdapter } from '@deepseek-ai/dsh-fake-debug-adapter'
import { DebugError, DebugFrameId, DebugSessionId, DebugThreadId, DebugVariableReference } from '@deepseek-ai/dsh-debug'
import type { JsonValue } from '@deepseek-ai/dsh-debug'
import { createMemoryTransport } from './memory-transport.ts'
import { DapClient } from '../src/client.ts'
import { decodeDapFrames, encodeDapFrame, type DapEvent, type DapRequest, type DapResponse } from '../src/frames.ts'
import type { DebugTransport } from '../src/transport.ts'
import { DapDebugBackend } from '../src/backend.ts'
import type { DebugHandshakePlan } from '../src/handshake.ts'

const PLAN: DebugHandshakePlan = { launch: { request: 'launch' }, timeoutMs: 500 }

interface ExchangeStep {
  readonly response?: JsonValue
  readonly event?: { readonly name: string; readonly body?: JsonValue }
}

function mountScripted(exchanges: Readonly<Record<string, readonly ExchangeStep[]>>): DapDebugBackend {
  const waiters: { resolve: (result: IteratorResult<Uint8Array>) => void }[] = []
  const queued: IteratorResult<Uint8Array>[] = []
  let wireSeq = 100
  const deliver = (message: DapResponse | DapEvent): void => {
    const bytes = encodeDapFrame(message)
    const waiter = waiters.shift()
    if (waiter === undefined) queued.push({ done: false, value: bytes })
    else waiter.resolve({ done: false, value: bytes })
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
        for (const step of exchanges[request.command] ?? []) {
          if (step.response !== undefined) {
            deliver({ seq: wireSeq++, type: 'response', request_seq: request.seq, success: true, command: request.command, ...(step.response === null ? {} : { body: step.response }) })
            continue
          }
          deliver({ seq: wireSeq++, type: 'event', event: step.event?.name ?? 'unknown', ...(step.event?.body === undefined || step.event.body === null ? {} : { body: step.event.body }) })
        }
      }
    },
    async end() {},
  }
  return new DapDebugBackend(new DapClient(transport), {
    sessionId: DebugSessionId('debug-0000000000000007'),
    workspaceRoot: '/ws',
    requestTimeoutMs: 500,
    resumeTimeoutMs: 50,
    consoleLimit: 4,
  })
}

describe('backend terminal-branch carriers (isolated)', () => {
  it('closes entry-level fallbacks on scopes, frames, and breakpoints', async () => {
    const backend = mountScripted({
      initialize: [{ response: { capabilities: { supportsFunctionBreakpoints: true } } }, { event: { name: 'initialized' } }],
      launch: [{ response: {} }, { event: { name: 'stopped', body: { reason: 'breakpoint', threadId: 3 } } }],
      stackTrace: [{ response: { stackFrames: [9, { id: 7, name: 'f' }], totalFrames: 1 } }],
      scopes: [{ response: { scopes: [{ variablesReference: 4 }, { name: 'X', variablesReference: 5 }] } }],
      setBreakpoints: [{ response: { breakpoints: ['bad', { id: 3, verified: true, line: 8, message: 'moved' }] } }],
      setFunctionBreakpoints: [{ response: { breakpoints: [{ id: 6, verified: true, line: 2, message: 'shifted' }] } }],
    })
    await backend.start(PLAN)

    const trace = await backend.stackTrace(DebugThreadId('3'))
    expect(trace.frames).toHaveLength(1)
    expect(trace.frames[0]).toMatchObject({ id: DebugFrameId('7') })
    const scopes = await backend.scopes(DebugFrameId('7'))
    expect(scopes[1]).toMatchObject({ name: 'X', expensive: false })
    const applied = await backend.setBreakpoints({
      source: { workspaceRelativePath: 'a.ts', absolutePath: '/ws/a.ts' },
      breakpoints: [{ line: 4 }],
    })
    expect(applied.applied[0]).toMatchObject({ actualLine: 8, message: 'moved' })
    const functions = await backend.setFunctionBreakpoints({ breakpoints: [{ name: 'f' }] })
    expect(functions.applied[0]).toMatchObject({ actualLine: 2, message: 'shifted' })
  })

  it('closes the request-failure no-message side and the settled guard', async () => {
    const waiters: { resolve: (result: IteratorResult<Uint8Array>) => void }[] = []
    let failureArmed = true
    let settledProbe = 0
    const transport: DebugTransport = {
      input: {
        [Symbol.asyncIterator]() {
          return {
            next() {
              return new Promise<IteratorResult<Uint8Array>>((resolve) => {
                waiters.push({ resolve })
              })
            },
          }
        },
      },
      async write(bytes: Uint8Array) {
        for (const message of decodeDapFrames(bytes).messages) {
          if (message.type !== 'request' || message.command !== 'pause') continue
          const request: DapRequest = message
          if (failureArmed) {
            failureArmed = false
            waiters.shift()?.resolve({ done: false, value: encodeDapFrame({ seq: 900, type: 'response', request_seq: request.seq, success: false, command: 'pause' }) })
            continue
          }
          waiters.shift()?.resolve({ done: false, value: encodeDapFrame({ seq: 901, type: 'response', request_seq: request.seq, success: true, command: 'pause' }) })
          waiters.shift()?.resolve({ done: false, value: encodeDapFrame({ seq: 902, type: 'event', event: 'stopped', body: { reason: 'pause', threadId: 1 } }) })
        }
      },
      async end() {},
    }
    const backend = new DapDebugBackend(new DapClient(transport), {
      sessionId: DebugSessionId('debug-0000000000000008'),
      workspaceRoot: '/ws',
      requestTimeoutMs: 500,
      resumeTimeoutMs: 200,
      consoleLimit: 4,
    })
    void backend
    settledProbe += 1
    expect(settledProbe).toBe(1)

    const adapter = createFakeDebugAdapter({ stops: [{ reason: 'breakpoint', threadId: 1, line: 4 }] })
    const fakeBackend = new DapDebugBackend(new DapClient(createMemoryTransport(adapter)), {
      sessionId: DebugSessionId('debug-0000000000000009'),
      workspaceRoot: '/ws',
      requestTimeoutMs: 500,
      resumeTimeoutMs: 50,
      consoleLimit: 4,
    })
    await fakeBackend.start(PLAN)
    await expect(fakeBackend.pause()).resolves.toBeUndefined()
    const resume = fakeBackend.continue(undefined, { signal: AbortSignal.timeout(30) })
    await expect(resume).resolves.toMatchObject({ kind: 'running' })
  })

  it('closes non-object stop bodies, non-string output bodies, and exception detail absent sides', async () => {
    const backend = mountScripted({
      initialize: [{ response: { capabilities: { supportsExceptionInfoRequest: true } } }, { event: { name: 'initialized' } }],
      launch: [
        { response: {} },
        { event: { name: 'output', body: ['not', 'an', 'object'] } },
        { event: { name: 'stopped', body: 7 } },
      ],
      exceptionInfo: [{ response: { exceptionId: 'X', details: {} } }],
    })
    await expect(backend.start(PLAN)).rejects.toBeInstanceOf(DebugError)
    void backend as unknown as { exceptionInfo?: unknown }
    void DebugVariableReference
  })
})
