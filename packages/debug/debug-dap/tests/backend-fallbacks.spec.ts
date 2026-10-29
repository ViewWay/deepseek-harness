import { describe, expect, it } from 'vitest'
import { createFakeDebugAdapter } from '@deepseek-ai/dsh-fake-debug-adapter'
import { DebugFrameId, DebugSessionId, DebugThreadId, DebugVariableReference } from '@deepseek-ai/dsh-debug'
import type { JsonValue } from '@deepseek-ai/dsh-debug'
import { createMemoryTransport } from './memory-transport.ts'
import { DapClient } from '../src/client.ts'
import { decodeDapFrames, encodeDapFrame, type DapEvent, type DapRequest, type DapResponse } from '../src/frames.ts'
import type { DebugTransport } from '../src/transport.ts'
import { DapDebugBackend } from '../src/backend.ts'
import type { DebugHandshakePlan } from '../src/handshake.ts'

const PLAN: DebugHandshakePlan = { launch: { request: 'launch' }, timeoutMs: 500 }

function mountFake(script: Parameters<typeof createFakeDebugAdapter>[0] = {}, workspaceRoot = '/ws'): DapDebugBackend {
  return new DapDebugBackend(new DapClient(createMemoryTransport(createFakeDebugAdapter(script))), {
    sessionId: DebugSessionId('debug-0000000000000004'),
    workspaceRoot,
    requestTimeoutMs: 500,
    resumeTimeoutMs: 50,
    consoleLimit: 4,
  })
}

interface ExchangeStep {
  readonly response?: JsonValue
  readonly event?: { readonly name: string; readonly body?: { readonly [key: string]: JsonValue } }
  readonly reverseRequest?: { readonly command: string }
}

function mountScripted(exchanges: Readonly<Record<string, readonly ExchangeStep[]>>, workspaceRoot = '/ws'): { backend: DapDebugBackend; requests: string[] } {
  const requests: string[] = []
  const waiters: { resolve: (result: IteratorResult<Uint8Array>) => void }[] = []
  const queued: IteratorResult<Uint8Array>[] = []
  let wireSeq = 100
  const deliver = (message: DapResponse | DapEvent | DapRequest): void => {
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
        requests.push(request.command)
        for (const step of exchanges[request.command] ?? []) {
          if (step.response !== undefined) {
            deliver({ seq: wireSeq++, type: 'response', request_seq: request.seq, success: true, command: request.command, body: step.response })
            continue
          }
          if (step.event !== undefined) {
            deliver({ seq: wireSeq++, type: 'event', event: step.event.name, body: step.event.body ?? {} })
            continue
          }
          deliver({ seq: wireSeq++, type: 'request', command: step.reverseRequest?.command ?? 'unknown', arguments: {} })
        }
      }
    },
    async end() {},
  }
  return {
    backend: new DapDebugBackend(new DapClient(transport), {
      sessionId: DebugSessionId('debug-0000000000000005'),
      workspaceRoot,
      requestTimeoutMs: 500,
      resumeTimeoutMs: 50,
      consoleLimit: 4,
      reverseRequests: {
        startDebugging: async () => ({}),
      },
    }),
    requests,
  }
}

describe('backend fallback branches (isolated carrier)', () => {
  it('falls back across non-array, non-object, and short wire payloads', async () => {
    const scripted = mountScripted({
      initialize: [{ response: { capabilities: {} } }, { event: { name: 'initialized' } }, { reverseRequest: { command: 'startDebugging' } }],
      launch: [{ response: {} }, { event: { name: 'stopped', body: { reason: 'breakpoint', threadId: 3 } } }],
      threads: [{ response: { threads: 7 } }],
      stackTrace: [{ response: { stackFrames: [{ id: 7, name: 'f' }], totalFrames: 1 } }],
      scopes: [{ response: { scopes: [{ name: 'X' }] } }],
      evaluate: [{ response: ['not', 'an', 'object'] }],
      setBreakpoints: [{ response: ['nope'] }],
    })
    const backend = scripted.backend
    await backend.start(PLAN)

    await expect(backend.threads()).resolves.toEqual([])

    const emptyThreads = mountScripted({
      initialize: [{ response: { capabilities: {} } }, { event: { name: 'initialized' } }],
      launch: [{ response: {} }, { event: { name: 'terminated' } }],
      threads: [{ response: {} }],
    })
    await emptyThreads.backend.start(PLAN)
    await expect(emptyThreads.backend.threads()).resolves.toEqual([])

    const flatRoot = mountScripted({
      initialize: [{ response: { capabilities: { supportsLoadedSourcesRequest: true, supportsDisassembleRequest: true } } }, { event: { name: 'initialized' } }],
      launch: [{ response: {} }, { event: { name: 'terminated' } }],
      loadedSources: [{ response: { sources: [{ path: '/flat/b.ts' }] } }],
      disassemble: [{ response: { instructions: [{ address: '0x2', instruction: 'ret' }] } }],
    }, '')
    await flatRoot.backend.start(PLAN)
    await expect(flatRoot.backend.loadedSources()).resolves.toEqual([{ workspaceRelativePath: '/flat/b.ts', absolutePath: '/flat/b.ts' }])
    await expect(flatRoot.backend.disassemble({ memoryReference: '0x2', instructionCount: 1 })).resolves.toMatchObject({ instructions: [{ address: '0x2' }] })
    const trace = await backend.stackTrace(DebugThreadId('3'))
    const frame = trace.frames[0]?.id ?? DebugFrameId('7')
    await expect(backend.scopes(frame)).rejects.toMatchObject({ code: 'DEBUG_MALFORMED_RESPONSE' })
    await expect(backend.evaluate('e', 'repl')).rejects.toMatchObject({ code: 'DEBUG_MALFORMED_RESPONSE' })
    const applied = await backend.setBreakpoints({
      source: { workspaceRelativePath: 'a.ts', absolutePath: '/ws/a.ts' },
      breakpoints: [{ line: 4 }, { line: 5 }],
    })
    expect(applied.rejected).toHaveLength(2)
    expect(applied.rejected[0]).toMatchObject({ verified: false })

    const variableMount = mountScripted({
      initialize: [{ response: { capabilities: {} } }, { event: { name: 'initialized' } }],
      launch: [{ response: {} }, { event: { name: 'stopped', body: { reason: 'breakpoint', threadId: 3 } } }],
      stackTrace: [{ response: { stackFrames: [{ id: 7, name: 'f' }], totalFrames: 1 } }],
      scopes: [{ response: { scopes: [{ name: 'L', variablesReference: 8, expensive: true }] } }],
      variables: [{ response: { variables: [7] } }],
    })
    await variableMount.backend.start(PLAN)
    const variableFrame = (await variableMount.backend.stackTrace(DebugThreadId('3'))).frames[0]?.id ?? DebugFrameId('7')
    const scopes = await variableMount.backend.scopes(variableFrame)
    expect(scopes[0]).toMatchObject({ name: 'L', expensive: true })
    await expect(variableMount.backend.variables(scopes[0]?.variablesReference ?? DebugVariableReference('8')))
      .rejects.toMatchObject({ code: 'DEBUG_MALFORMED_RESPONSE' })
  })

  it('maps full exception details and applies trailing-slash workspace roots', async () => {
    const scoped = mountScripted({
      initialize: [{ response: { capabilities: { supportsExceptionInfoRequest: true } } }, { event: { name: 'initialized' } }],
      launch: [{ response: {} }, { event: { name: 'stopped', body: { reason: 'exception', threadId: 3 } } }],
      exceptionInfo: [{ response: {
        exceptionId: 'E',
        description: 'd',
        breakMode: 'always',
        details: { message: 'm', typeName: 'T', fullTypeName: 'FT', evaluateName: 'e', stack: 'S' },
      } }],
    })
    await scoped.backend.start(PLAN)
    await expect(scoped.backend.exceptionInfo(DebugThreadId('3'))).resolves.toMatchObject({
      exceptionId: 'E',
      breakMode: 'always',
      details: { message: 'm', typeName: 'T', fullTypeName: 'FT', evaluateName: 'e', stack: 'S' },
    })

    const trailing = mountFake({ stops: [
      { reason: 'exception', threadId: 1, line: 2 },
      { reason: 'breakpoint', threadId: 1, line: 3 },
    ] }, '/ws/')
    await trailing.start(PLAN)
    const resume = await trailing.continue()
    expect(resume).toMatchObject({ kind: 'stopped', stop: { source: { workspaceRelativePath: 'a.ts' } } })
  })
})
