import { describe, expect, it, vi } from 'vitest'
import { createFakeDebugAdapter } from '@deepseek-ai/dsh-fake-debug-adapter'
import { DebugBreakpointId, DebugFrameId, DebugSessionId, DebugSourceReference, DebugThreadId, DebugVariableReference } from '@deepseek-ai/dsh-debug'
import type { JsonValue } from '@deepseek-ai/dsh-debug'
import { createMemoryTransport } from './memory-transport.ts'
import { DapClient } from '../src/client.ts'
import { decodeDapFrames, encodeDapFrame, type DapEvent, type DapRequest, type DapResponse } from '../src/frames.ts'
import type { DebugTransport } from '../src/transport.ts'
import { DapDebugBackend } from '../src/backend.ts'
import type { DebugHandshakePlan } from '../src/handshake.ts'

const HANDSHAKE_PLAN: DebugHandshakePlan = { launch: { request: 'launch' }, timeoutMs: 1000 }

interface Mounted {
  readonly backend: DapDebugBackend
  readonly sentCommands: readonly string[]
  readonly adapter?: ReturnType<typeof createFakeDebugAdapter>
}

type BackendOptions = ConstructorParameters<typeof DapDebugBackend>[1]

function mountBackend(
  script: Parameters<typeof createFakeDebugAdapter>[0] = {},
  options: Partial<BackendOptions> = {},
): Mounted {
  const adapter = createFakeDebugAdapter(script)
  const backend = new DapDebugBackend(new DapClient(createMemoryTransport(adapter)), {
    sessionId: DebugSessionId('debug-0000000000000001'),
    workspaceRoot: '/ws',
    requestTimeoutMs: 1000,
    resumeTimeoutMs: 50,
    consoleLimit: 4,
    ...options,
  })
  return { backend, sentCommands: [], adapter }
}

interface ExchangeStep {
  readonly response?: JsonValue
  readonly event?: { readonly name: string; readonly body?: { readonly [key: string]: JsonValue } }
}

function mountScripted(exchanges: Readonly<Record<string, readonly ExchangeStep[]>>): Mounted {
  const sentCommands: string[] = []
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
        sentCommands.push(request.command)
        for (const step of exchanges[request.command] ?? []) {
          if (step.response !== undefined) {
            deliver({ seq: wireSeq++, type: 'response', request_seq: request.seq, success: true, command: request.command, body: step.response })
            continue
          }
          if (step.event !== undefined) {
            deliver({ seq: wireSeq++, type: 'event', event: step.event.name, body: step.event.body ?? {} })
          }
        }
      }
    },
    async end() {},
  }
  const backend = new DapDebugBackend(new DapClient(transport), {
    sessionId: DebugSessionId('debug-0000000000000002'),
    workspaceRoot: '/ws',
    requestTimeoutMs: 1000,
    resumeTimeoutMs: 30,
    consoleLimit: 3,
  })
  return { backend, sentCommands }
}

describe('DapDebugBackend lifecycle', () => {
  it('steps to the next scripted stop and serves inspection while stopped', async () => {
    const { backend } = mountBackend({ stops: [
      { reason: 'breakpoint', threadId: 1, line: 4 },
      { reason: 'step', threadId: 1, line: 5 },
    ] })
    await backend.start(HANDSHAKE_PLAN)
    await expect(backend.step('over', undefined, 'line')).resolves.toMatchObject({
      kind: 'stopped',
      stop: { reason: 'step', sessionId: DebugSessionId('debug-0000000000000001'), threadId: DebugThreadId('1'), line: 5, source: { workspaceRelativePath: 'a.ts', absolutePath: '/ws/a.ts' } },
    })
    const trace = await backend.stackTrace(DebugThreadId('1'))
    expect(trace.frames[0]).toMatchObject({ id: DebugFrameId('1001'), line: 5 })
    expect(trace.frames[0]?.source?.absolutePath).toBe('/ws/a.ts')
    expect(trace.frames[0]?.source?.workspaceRelativePath).toBe('a.ts')
    expect(trace.totalFrames).toBe(1)
    expect(trace.truncated).toBe(false)
    const scopes = await backend.scopes(DebugFrameId('1001'))
    expect(scopes[0]).toMatchObject({ name: 'Locals', variablesReference: DebugVariableReference('2001'), expensive: false })
    const page = await backend.variables(DebugVariableReference('2001'))
    expect(page.variables.map(variable => variable.name)).toEqual(['count', 'items'])
    expect(page.truncated).toBe(false)
    const evaluation = await backend.evaluate('1+1', 'repl')
    expect(evaluation).toMatchObject({ result: 'eval:1+1', type: 'string', variablesReference: DebugVariableReference('0') })
  })

  it('rejects inspection while not stopped and disconnects cleanly', async () => {
    const { backend } = mountBackend()
    await backend.start(HANDSHAKE_PLAN)
    await expect(backend.stackTrace(DebugThreadId('1'))).rejects.toMatchObject({ code: 'DEBUG_NOT_STOPPED' })
    await expect(backend.evaluate('1+1', 'repl')).rejects.toMatchObject({ code: 'DEBUG_NOT_STOPPED' })
    await expect(backend.disconnect()).resolves.toBeUndefined()
    await expect(backend.continue()).rejects.toMatchObject({ code: 'DEBUG_INVALID_STATE' })
  })

  it('continues through the stop script to termination', async () => {
    const { backend } = mountBackend({ stops: [
      { reason: 'breakpoint', threadId: 1, line: 4 },
      { reason: 'breakpoint', threadId: 1, line: 5 },
    ] })
    await backend.start(HANDSHAKE_PLAN)
    await expect(backend.continue()).resolves.toMatchObject({ kind: 'stopped', stop: { reason: 'breakpoint', line: 5 } })
    await expect(backend.continue()).resolves.toMatchObject({ kind: 'terminated' })
    await expect(backend.continue()).rejects.toMatchObject({ code: 'DEBUG_INVALID_STATE' })
  })

  it('falls back to an empty stop position when the adapter rejects the snapshot stack', async () => {
    const { backend } = mountBackend({ stops: [
      { reason: 'pause', threadId: 1, line: 9 },
      { reason: 'breakpoint', threadId: 1, line: 6 },
    ], fail: ['stackTrace'] })
    await backend.start(HANDSHAKE_PLAN)
    const resume = await backend.continue(DebugThreadId('1'))
    expect(resume).toMatchObject({ kind: 'stopped', stop: { reason: 'breakpoint', source: { absolutePath: '' }, line: 1 } })
  })

  it('resolves running when no stop arrives within the resume window', async () => {
    const scripted = mountScripted({
      initialize: [{ response: { capabilities: {} } }, { event: { name: 'initialized' } }],
      launch: [{ response: {} }, { event: { name: 'stopped', body: { reason: 'breakpoint', threadId: 1 } } }, { event: { name: 'continued', body: { threadId: 1 } } }],
      stackTrace: [{ response: { stackFrames: [], totalFrames: 0 } }],
      continue: [{ response: { allThreadsContinued: false } }],
    })
    await scripted.backend.start(HANDSHAKE_PLAN)
    await expect(scripted.backend.continue()).resolves.toMatchObject({ kind: 'running' })
    await new Promise(resolve => setTimeout(resolve, 10))
    await expect(scripted.backend.stackTrace(DebugThreadId('1'))).rejects.toMatchObject({ code: 'DEBUG_NOT_STOPPED' })
  })

  it('resolves running immediately when the caller aborts the resume wait', async () => {
    const scripted = mountScripted({
      initialize: [{ response: { capabilities: {} } }, { event: { name: 'initialized' } }],
      launch: [{ response: {} }, { event: { name: 'stopped', body: { reason: 'breakpoint', threadId: 1 } } }],
      stackTrace: [{ response: { stackFrames: [], totalFrames: 0 } }],
      continue: [{ response: { allThreadsContinued: false } }],
    })
    await scripted.backend.start(HANDSHAKE_PLAN)
    await expect(scripted.backend.continue(undefined, { signal: AbortSignal.abort() })).resolves.toMatchObject({ kind: 'running' })
  })

  it('pauses into a stop snapshot without consuming the script', async () => {
    const { backend } = mountBackend({ stops: [
      { reason: 'breakpoint', threadId: 1, line: 4 },
      { reason: 'breakpoint', threadId: 1, line: 5 },
    ] })
    await backend.start(HANDSHAKE_PLAN)
    await expect(backend.pause()).resolves.toBeUndefined()
    const resume = await backend.continue()
    expect(resume).toMatchObject({ kind: 'stopped', stop: { reason: 'breakpoint', line: 5 } })
  })

  it('restarts and terminates through the adapter', async () => {
    const { backend } = mountBackend({ stops: [{ reason: 'breakpoint', threadId: 1, line: 4 }] })
    await backend.start(HANDSHAKE_PLAN)
    await expect(backend.restart()).resolves.toBeUndefined()
    await expect(backend.continue()).resolves.toMatchObject({ kind: 'terminated' })
    await expect(backend.terminate()).resolves.toBeUndefined()
  })

  it('maps verified breakpoints into applied results', async () => {
    const { backend } = mountBackend({ stops: [{ reason: 'entry', threadId: 1, line: 1 }] })
    await backend.start(HANDSHAKE_PLAN)
    const result = await backend.setBreakpoints({
      source: { workspaceRelativePath: 'a.ts', absolutePath: '/ws/a.ts' },
      breakpoints: [{ line: 4 }, { line: 8, column: 2, condition: 'x > 1' }],
    })
    expect(result.applied).toHaveLength(2)
    expect(result.applied[0]).toMatchObject({ requestedLine: 4, actualLine: 4, verified: true })
    expect(result.applied[1]).toMatchObject({ requestedLine: 8, actualLine: 8 })
    expect(result.rejected).toHaveLength(0)

    const functions = await backend.setFunctionBreakpoints({ breakpoints: [{ name: 'main' }] })
    expect(functions.applied[0]).toMatchObject({ verified: true })
    const exceptions = await backend.setExceptionBreakpoints({ filters: ['all'] })
    expect(exceptions).toEqual({ applied: [], rejected: [] })
  })

  it('rejects stale frame and variable references after a resume', async () => {
    const { backend } = mountBackend({ stops: [
      { reason: 'breakpoint', threadId: 1, line: 4 },
      { reason: 'step', threadId: 1, line: 5 },
    ] })
    await backend.start(HANDSHAKE_PLAN)
    const trace = await backend.stackTrace(DebugThreadId('1'))
    const frameId = trace.frames[0]?.id ?? DebugFrameId('0')
    await backend.scopes(frameId)
    const resume = await backend.step('in')
    expect(resume).toMatchObject({ kind: 'stopped' })
    await expect(backend.scopes(frameId)).rejects.toMatchObject({ code: 'DEBUG_STALE_REFERENCE' })
    await expect(backend.variables(DebugVariableReference('2001'))).rejects.toMatchObject({ code: 'DEBUG_STALE_REFERENCE' })
    await expect(backend.scopes(DebugFrameId('999999'))).rejects.toMatchObject({ code: 'DEBUG_STALE_REFERENCE' })
    const fresh = await backend.stackTrace(DebugThreadId('1'))
    await expect(backend.scopes(fresh.frames[0]?.id ?? DebugFrameId('0'))).resolves.toBeTruthy()
  })



  describe('DapDebugBackend console ring', () => {
    it('bounds the ring and pages with a non-consuming cursor', async () => {
      const scripted = mountScripted({
        initialize: [{ response: { capabilities: {} } }, { event: { name: 'initialized' } }],
        launch: [
          { response: {} },
          { event: { name: 'output', body: { category: 'stdout', output: 'one' } } },
          { event: { name: 'output', body: { category: 'weird', output: 'two' } } },
          { event: { name: 'output', body: { output: 'three', groupId: 9, variablesReference: 42 } } },
          { event: { name: 'output', body: { category: 'stderr', output: 'four' } } },
          { event: { name: 'output', body: { category: 'telemetry', output: 'five' } } },
          { event: { name: 'terminated' } },
        ],
      })
      await scripted.backend.start(HANDSHAKE_PLAN)
      const first = await scripted.backend.console({ limit: 2 })
      expect(first.entries.map(entry => entry.output)).toEqual(['three', 'four'])
      expect(first.entries[0]).toMatchObject({ category: 'console', groupId: 9, variablesReference: DebugVariableReference('42') })
      expect(first.entries[1]).toMatchObject({ category: 'stderr' })
      expect(first.truncated).toBe(true)
      expect(first.nextOffset).toBe(4)

      const second = await scripted.backend.console({ offset: first.nextOffset })
      expect(second.entries.map(entry => entry.output)).toEqual(['five'])
      expect(second.truncated).toBe(false)
      expect(second.nextOffset).toBe(5)

      const all = await scripted.backend.console()
      expect(all.entries).toHaveLength(3)
      expect(all.truncated).toBe(false)
    })
  })

  describe('DapDebugBackend reverse requests', () => {
    it('routes runInTerminal through the configured handler', async () => {
      const commands: string[] = []
      const { backend, adapter } = mountBackend({ stops: [{ reason: 'breakpoint', threadId: 1, line: 4 }], runInTerminal: { args: ['node', 'app.js'] } }, {
        reverseRequests: {
          runInTerminal: async (request) => {
            commands.push(request.command)
            return { processId: 777 }
          },
        },
      })
      if (adapter === undefined) throw new Error('fake adapter missing')
      await backend.start(HANDSHAKE_PLAN)
      await vi.waitFor(() => { expect(adapter.reverseRequestResponses).toHaveLength(1) })
      expect(commands).toEqual(['runInTerminal'])
      expect(adapter.reverseRequestResponses[0]).toMatchObject({ success: true, body: { processId: 777 } })
    })

    it('answers unknown reverse requests with an unsupported failure', async () => {
      const { backend, adapter } = mountBackend({ stops: [{ reason: 'breakpoint', threadId: 1, line: 4 }], runInTerminal: { args: ['node', 'app.js'] } })
      if (adapter === undefined) throw new Error('fake adapter missing')
      await backend.start(HANDSHAKE_PLAN)
      await vi.waitFor(() => { expect(adapter.reverseRequestResponses).toHaveLength(1) })
      const response = adapter.reverseRequestResponses[0]
      expect(response).toMatchObject({ success: false, message: expect.stringMatching(/unsupported reverse request/) as string })
    })
  })

  describe('DapDebugBackend command mapping', () => {
    it('maps adapter rejections of declared capabilities to launch failures', async () => {
      const { backend } = mountBackend({ capabilities: { supportsCompletionsRequest: true, supportsRestartFrame: true }, stops: [{ reason: 'breakpoint', threadId: 1, line: 4 }] })
      await backend.start(HANDSHAKE_PLAN)
      await expect(backend.completions('x', 1)).rejects.toMatchObject({ code: 'DEBUG_LAUNCH_FAILED' })
      const trace = await backend.stackTrace(DebugThreadId('1'))
      await expect(backend.restartFrame(trace.frames[0]?.id ?? DebugFrameId('0'))).rejects.toMatchObject({ code: 'DEBUG_LAUNCH_FAILED' })
    })

    it('maps inspection commands onto seam types', async () => {
      const scripted = mountScripted({
        initialize: [{ response: { capabilities: {
          supportsSetVariable: true,
          supportsSetExpression: true,
          supportsCompletionsRequest: true,
          supportsExceptionInfoRequest: true,
          supportsModulesRequest: true,
          supportsLoadedSourcesRequest: true,
          supportsDisassembleRequest: true,
          supportsReadMemoryRequest: true,
          supportsWriteMemoryRequest: true,
          supportsRestartFrame: true,
        } } }, { event: { name: 'initialized' } }],
        launch: [{ response: {} }, { event: { name: 'stopped', body: { reason: 'breakpoint', threadId: 3 } } }],
        stackTrace: [{ response: { stackFrames: [{ id: 7, name: 'f', path: 'ignored' }], totalFrames: 1 } }],
        scopes: [{ response: { scopes: [{ name: 'Local', variablesReference: 9, expensive: false }] } }],
        threads: [{ response: { threads: [{ id: 3, name: 'worker' }] } }],
        setVariable: [{ response: { name: 'x', value: '2', type: 'number', variablesReference: 0 } }],
        setExpression: [{ response: { result: '2', variablesReference: 0 } }],
        completions: [{ response: { targets: [{ label: 'x', text: 'x=', start: 0, length: 1 }] } }],
        exceptionInfo: [{ response: { exceptionId: 'E1', description: 'boom', breakMode: 'always', details: { message: 'm', typeName: 'T' } } }],
        modules: [{ response: { modules: [{ id: 1, name: 'm', path: '/p', version: 'v' }], totalModules: 5 } }],
        loadedSources: [{ response: { sources: [{ path: '/ws/b.ts', sourceReference: 5 }] } }],
        source: [{ response: { content: 'let x = 1', mimeType: 'text/x-typescript' } }],
        disassemble: [{ response: { instructions: [{ address: '0x1', instruction: 'mov', symbol: 'f', location: { path: '/ws/a.ts' }, line: 3, column: 1 }] } }],
        readMemory: [{ response: { data: 'QUJD' } }],
        writeMemory: [{ response: {} }],
        restartFrame: [{ response: {} }],
      })
      const backend = scripted.backend
      await backend.start(HANDSHAKE_PLAN)

      await expect(backend.threads()).resolves.toMatchObject([{ id: DebugThreadId('3'), name: 'worker' }])
      const trace = await backend.stackTrace(DebugThreadId('3'))
      expect(trace.frames[0]).toMatchObject({ id: DebugFrameId('7'), name: 'f' })
      const scopes = await backend.scopes(trace.frames[0]?.id ?? DebugFrameId('7'))
      expect(scopes[0]).toMatchObject({ name: 'Local', variablesReference: DebugVariableReference('9') })
      await expect(backend.setVariable(scopes[0]?.variablesReference ?? DebugVariableReference('9'), 'x', '2')).resolves.toMatchObject({ name: 'x', value: '2', type: 'number' })
      await expect(backend.setExpression('x', '2')).resolves.toMatchObject({ result: '2' })
      await expect(backend.completions('x', 1)).resolves.toEqual([{ label: 'x', text: 'x=', start: 0, length: 1 }])
      await expect(backend.exceptionInfo(DebugThreadId('3'))).resolves.toMatchObject({ exceptionId: 'E1', breakMode: 'always', details: { message: 'm', typeName: 'T' } })
      const modules = await backend.modules({ moduleCount: 1 })
      expect(modules).toMatchObject({ totalModules: 5, truncated: true })
      expect(modules.modules[0]).toMatchObject({ id: 1, name: 'm', path: '/p', version: 'v' })
      await expect(backend.loadedSources()).resolves.toEqual([
        { workspaceRelativePath: 'b.ts', absolutePath: '/ws/b.ts', sourceReference: expect.anything() as string },
      ])
      await expect(backend.source(DebugSourceReference('5'))).resolves.toMatchObject({ content: 'let x = 1', mimeType: 'text/x-typescript' })
      await expect(backend.disassemble({ memoryReference: '0x1', instructionCount: 1 })).resolves.toMatchObject({
        instructions: [{ address: '0x1', instruction: 'mov', symbol: 'f', line: 3, column: 1 }],
      })
      await expect(backend.readMemory({ memoryReference: '0x1', count: 3 })).resolves.toEqual(new TextEncoder().encode('ABC'))
      await expect(backend.writeMemory({ memoryReference: '0x1', data: 'QUJD' })).resolves.toBeUndefined()
      await expect(backend.restartFrame(trace.frames[0]?.id ?? DebugFrameId('7'))).resolves.toBeUndefined()
    })

    it('maps unverified breakpoints to the rejected half', async () => {
      const scripted = mountScripted({
        initialize: [{ response: { capabilities: {} } }, { event: { name: 'initialized' } }],
        launch: [{ response: {} }, { event: { name: 'terminated' } }],
        setBreakpoints: [{ response: { breakpoints: [
          { id: 1, verified: false, line: 6, message: 'moved to next statement' },
        ] } }],
      })
      await scripted.backend.start(HANDSHAKE_PLAN)
      const result = await scripted.backend.setBreakpoints({
        source: { workspaceRelativePath: 'a.ts', absolutePath: '/ws/a.ts' },
        breakpoints: [{ line: 4 }],
      })
      expect(result.applied).toHaveLength(0)
      expect(result.rejected[0]).toMatchObject({ requestedLine: 4, actualLine: 6, verified: false, message: 'moved to next statement' })
    })

    it('covers failure messages, double settle, and reverse-request routing', async () => {
      const waiters: { resolve: (result: IteratorResult<Uint8Array>) => void }[] = []
      const queued: IteratorResult<Uint8Array>[] = []
      let wireSeq = 500
      const deliver = (message: Record<string, unknown>): void => {
        const bytes = encodeDapFrame(message as never)
        const waiter = waiters.shift()
        if (waiter === undefined) queued.push({ done: false, value: bytes })
        else waiter.resolve({ done: false, value: bytes })
      }
      const sent: { command: string; request_seq: number }[] = []
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
            sent.push({ command: message.command, request_seq: message.seq })
            if (message.command === 'initialize') {
              deliver({ seq: wireSeq++, type: 'response', request_seq: message.seq, success: false, command: 'initialize' })
              continue
            }
            deliver({ seq: wireSeq++, type: 'response', request_seq: message.seq, success: true, command: message.command, body: {} })
          }
        },
        async end() {},
      }
      const backend = new DapDebugBackend(new DapClient(transport), {
        sessionId: DebugSessionId('debug-0000000000000003'),
        workspaceRoot: '/ws',
        requestTimeoutMs: 100,
        resumeTimeoutMs: 20,
        consoleLimit: 4,
      })
      await expect(backend.setVariable(DebugVariableReference('1'), 'x', '1')).rejects.toMatchObject({ code: 'DEBUG_UNSUPPORTED_CAPABILITY' })
      await expect(backend.start(HANDSHAKE_PLAN)).rejects.toMatchObject({ code: 'DEBUG_LAUNCH_FAILED' })
      await backend.disconnect()
    })

    it('covers stop descriptions, console output fallbacks, and empty workspace roots', async () => {
      const { backend } = mountBackend({
        stops: [
          { reason: 'exception', threadId: 1, line: 2, description: 'boom' },
          { reason: 'breakpoint', threadId: 1, line: 3 },
        ],
        delayedEvent: { afterMs: 5, event: 'output', body: { category: 'stdout' } },
      }, { workspaceRoot: '' })
      await backend.start(HANDSHAKE_PLAN)
      const resume = await backend.continue()
      expect(resume).toMatchObject({ kind: 'stopped', stop: { reason: 'breakpoint', source: { workspaceRelativePath: '/ws/a.ts', absolutePath: '/ws/a.ts' } } })
      await new Promise(resolve => setTimeout(resolve, 15))
      const consolePage = await backend.console()
      expect(consolePage.entries[0]).toMatchObject({ category: 'stdout', output: '' })
    })

    it('covers non-object wire entries and present optional arguments', async () => {
      const scripted = mountScripted({
        initialize: [{ response: { capabilities: {
          supportsSetVariable: true,
          supportsSetExpression: true,
          supportsCompletionsRequest: true,
          supportsExceptionInfoRequest: true,
          supportsModulesRequest: true,
          supportsLoadedSourcesRequest: true,
          supportsDisassembleRequest: true,
        } } }, { event: { name: 'initialized' } }],
        launch: [{ response: {} }, { event: { name: 'stopped', body: { reason: 'breakpoint', threadId: 3 } } }],
        stackTrace: [{ response: { stackFrames: [{ id: 7, name: 'f' }], totalFrames: 2 } }],
        threads: [{ response: { threads: [7] } }],
        scopes: [{ response: { scopes: ['not-an-object'] } }],
        evaluate: [{ response: { result: 'r', type: 't', variablesReference: 9 } }],
        setExpression: [{ response: { result: 'ok', type: 't', variablesReference: 0 } }],
        setVariable: [{ response: { name: 'x', value: '1', type: 't', variablesReference: 0 } }],
        completions: [{ response: { targets: [3] } }],
        modules: [{ response: { modules: [4], totalModules: 2 } }],
        loadedSources: [{ response: { sources: [5] } }],
        disassemble: [{ response: { instructions: [6] } }],
      })
      const backend = scripted.backend
      await backend.start(HANDSHAKE_PLAN)

      await expect(backend.threads()).rejects.toMatchObject({ code: 'DEBUG_MALFORMED_RESPONSE' })
      const trace = await backend.stackTrace(DebugThreadId('3'), { startFrame: 0, levels: 1 })
      expect(trace).toMatchObject({ totalFrames: 2, truncated: true })
      const frame = trace.frames[0]?.id ?? DebugFrameId('7')
      await expect(backend.scopes(frame)).resolves.toEqual([])
      const evaluated = await backend.evaluate('e', 'repl', frame)
      expect(evaluated).toMatchObject({ result: 'r', type: 't' })
      await expect(backend.setExpression('x', '1', frame)).resolves.toMatchObject({ result: 'ok', type: 't' })
      await expect(backend.setVariable(DebugVariableReference('9'), 'x', '1')).resolves.toMatchObject({ name: 'x', type: 't' })
      await expect(backend.completions('t', 1, frame)).rejects.toMatchObject({ code: 'DEBUG_MALFORMED_RESPONSE' })
      await expect(backend.modules({ startModule: 0, moduleCount: 1 })).rejects.toMatchObject({ code: 'DEBUG_MALFORMED_RESPONSE' })
      await expect(backend.loadedSources()).resolves.toEqual([{ workspaceRelativePath: '', absolutePath: '' }])
      await expect(backend.disassemble({
        memoryReference: '0x1',
        instructionCount: 1,
        instructionOffset: -1,
        offset: 0,
        resolveSymbols: true,
      })).rejects.toMatchObject({ code: 'DEBUG_MALFORMED_RESPONSE' })
    })

    it('maps empty-object bodies and absent optional fields', async () => {
      const empty: { readonly [key: string]: never } = {}
      const capabilities = {
        supportsSetVariable: true,
        supportsCompletionsRequest: true,
        supportsExceptionInfoRequest: true,
        supportsModulesRequest: true,
        supportsLoadedSourcesRequest: true,
        supportsDisassembleRequest: true,
        supportsFunctionBreakpoints: true,
      }
      const scripted = mountScripted({
        initialize: [{ response: { capabilities } }, { event: { name: 'initialized' } }],
        launch: [{ response: {} }, { event: { name: 'stopped', body: { reason: 'breakpoint', threadId: 3 } } }],
        stackTrace: [{ response: { stackFrames: [{ id: 7, name: 'f', source: { path: '/x/b.ts' } }], totalFrames: 1 } }],
        threads: [{ response: empty }],
        scopes: [{ response: empty }],
        variables: [{ response: empty }],
        evaluate: [{ response: { result: 'r', variablesReference: 9 } }],
        setVariable: [{ response: { name: 'x', value: '1', variablesReference: 0 } }],
        completions: [{ response: { targets: [{ label: 'x' }] } }],
        exceptionInfo: [{ response: { exceptionId: 'X' } }],
        modules: [{ response: empty }],
        loadedSources: [{ response: { sources: [{ path: '/x/b.ts' }] } }],
        disassemble: [{ response: { instructions: [{ address: '0x1', instruction: 'nop' }] } }],
        setFunctionBreakpoints: [{ response: { breakpoints: [{ id: 4, verified: true }] } }],
      })
      const backend = scripted.backend
      await backend.start(HANDSHAKE_PLAN)

      await expect(backend.threads()).resolves.toEqual([])
      const trace = await backend.stackTrace(DebugThreadId('3'))
      expect(trace.frames[0]?.source).toMatchObject({ workspaceRelativePath: '/x/b.ts', absolutePath: '/x/b.ts' })
      const frame = trace.frames[0]?.id ?? DebugFrameId('7')
      await expect(backend.scopes(frame)).resolves.toEqual([])
      await expect(backend.evaluate('e', 'repl')).resolves.toMatchObject({ result: 'r' })
      await expect(backend.variables(DebugVariableReference('9'))).resolves.toMatchObject({ variables: [] })
      const assigned = await backend.setVariable(DebugVariableReference('9'), 'x', '1')
      expect(assigned).toMatchObject({ name: 'x', value: '1' })
      expect('type' in assigned).toBe(false)
      await expect(backend.completions('t', 1)).resolves.toEqual([{ label: 'x' }])
      const exception = await backend.exceptionInfo(DebugThreadId('3'))
      expect(exception).toMatchObject({ exceptionId: 'X', breakMode: 'never' })
      expect('details' in exception).toBe(false)
      expect('description' in exception).toBe(false)
      await expect(backend.modules()).resolves.toMatchObject({ modules: [], totalModules: 0 })
      await expect(backend.loadedSources()).resolves.toEqual([{ workspaceRelativePath: '/x/b.ts', absolutePath: '/x/b.ts' }])
      const disassembly = await backend.disassemble({ memoryReference: '0x1', instructionCount: 1 })
      expect(disassembly.instructions[0]).toMatchObject({ address: '0x1', instruction: 'nop' })
      expect('symbol' in (disassembly.instructions[0] ?? {})).toBe(false)
      const functions = await backend.setFunctionBreakpoints({ breakpoints: [{ name: 'f' }] })
      expect(functions.applied[0]).toMatchObject({ verified: true })
      expect('actualLine' in (functions.applied[0] ?? {})).toBe(false)
      expect('message' in (functions.applied[0] ?? {})).toBe(false)
    })

    it('maps degenerate response bodies defensively', async () => {
      const badBody = ['not', 'an', 'object']
      const capabilities = {
        supportsSetVariable: true,
        supportsSetExpression: true,
        supportsCompletionsRequest: true,
        supportsExceptionInfoRequest: true,
        supportsModulesRequest: true,
        supportsLoadedSourcesRequest: true,
        supportsDisassembleRequest: true,
      }
      const framed = mountScripted({
        initialize: [{ response: { capabilities } }, { event: { name: 'initialized' } }],
        launch: [{ response: {} }, { event: { name: 'stopped', body: { reason: 'breakpoint', threadId: 3 } } }],
        stackTrace: [{ response: { stackFrames: [{ id: 7, name: 'f' }], totalFrames: 1 } }],
        scopes: [{ response: badBody }],
        variables: [{ response: badBody }],
        setVariable: [{ response: badBody }],
        evaluate: [{ response: { result: 'r', variablesReference: 9 } }],
      })
      await framed.backend.start(HANDSHAKE_PLAN)
      const frame = (await framed.backend.stackTrace(DebugThreadId('3'))).frames[0]?.id ?? DebugFrameId('7')
      await expect(framed.backend.scopes(frame)).resolves.toEqual([])
      await expect(framed.backend.evaluate('e', 'repl')).resolves.toMatchObject({ result: 'r' })
      await expect(framed.backend.variables(DebugVariableReference('9'))).resolves.toMatchObject({ variables: [] })
      await expect(framed.backend.setVariable(DebugVariableReference('9'), 'x', '1')).rejects.toMatchObject({ code: 'DEBUG_MALFORMED_RESPONSE' })

      const degenerate = mountScripted({
        initialize: [{ response: { capabilities } }, { event: { name: 'initialized' } }],
        launch: [{ response: {} }, { event: { name: 'stopped', body: { reason: 'breakpoint', threadId: 3 } } }],
        stackTrace: [{ response: badBody }],
        threads: [{ response: badBody }],
        evaluate: [{ response: badBody }],
        setExpression: [{ response: badBody }],
        completions: [{ response: badBody }],
        exceptionInfo: [{ response: badBody }],
        modules: [{ response: badBody }],
        loadedSources: [{ response: badBody }],
        source: [{ response: badBody }],
        disassemble: [{ response: badBody }],
      })
      const backend = degenerate.backend
      await backend.start(HANDSHAKE_PLAN)

      await expect(backend.threads()).resolves.toEqual([])
      await expect(backend.stackTrace(DebugThreadId('3'))).rejects.toMatchObject({ code: 'DEBUG_MALFORMED_RESPONSE' })
      await expect(backend.evaluate('e', 'repl')).rejects.toMatchObject({ code: 'DEBUG_MALFORMED_RESPONSE' })
      await expect(backend.setExpression('x', '1')).rejects.toMatchObject({ code: 'DEBUG_MALFORMED_RESPONSE' })
      await expect(backend.completions('t', 1)).resolves.toEqual([])
      await expect(backend.exceptionInfo(DebugThreadId('3'))).rejects.toMatchObject({ code: 'DEBUG_MALFORMED_RESPONSE' })
      await expect(backend.modules()).resolves.toMatchObject({ modules: [], totalModules: 0, truncated: false })
      await expect(backend.loadedSources()).resolves.toEqual([])
      await expect(backend.source(DebugSourceReference('3'))).rejects.toMatchObject({ code: 'DEBUG_MALFORMED_RESPONSE' })
      await expect(backend.disassemble({ memoryReference: '0x1', instructionCount: 1 })).resolves.toMatchObject({ instructions: [] })
    })

    it('registers an abort listener when a live signal accompanies the resume', async () => {
      const scripted = mountScripted({
        initialize: [{ response: { capabilities: {} } }, { event: { name: 'initialized' } }],
        launch: [{ response: {} }, { event: { name: 'stopped', body: { reason: 'breakpoint', threadId: 1 } } }],
        stackTrace: [{ response: { stackFrames: [], totalFrames: 0 } }],
        continue: [{ response: { allThreadsContinued: false } }],
      })
      await scripted.backend.start(HANDSHAKE_PLAN)
      const controller = new AbortController()
      await expect(scripted.backend.continue(undefined, { signal: controller.signal })).resolves.toMatchObject({ kind: 'running' })
    })

    it('contains a stopped event whose body is not an object', async () => {
      const scripted = mountScripted({
        initialize: [{ response: { capabilities: {} } }, { event: { name: 'initialized' } }],
        launch: [{ response: {} }, { event: { name: 'stopped' } }],
      })
      await expect(scripted.backend.start(HANDSHAKE_PLAN)).rejects.toMatchObject({ code: 'DEBUG_MALFORMED_RESPONSE' })
    })

    it('maps minimal wire responses without optional fields', async () => {
      const scripted = mountScripted({
        initialize: [{ response: { capabilities: {
          supportsSetVariable: true,
          supportsSetExpression: true,
          supportsCompletionsRequest: true,
          supportsExceptionInfoRequest: true,
          supportsModulesRequest: true,
          supportsLoadedSourcesRequest: true,
          supportsDisassembleRequest: true,
          supportsReadMemoryRequest: true,
          supportsWriteMemoryRequest: true,
          supportsFunctionBreakpoints: true,
          supportsDataBreakpoints: true,
          supportsInstructionBreakpoints: true,
          supportsStepBack: true,
          supportsRestartFrame: true,
        } } }, { event: { name: 'initialized' } }],
        launch: [{ response: {} }, { event: { name: 'stopped', body: { reason: 'goto', threadId: 5 } } }],
        stackTrace: [{ response: { stackFrames: [{ id: 3, name: 'g' }], totalFrames: 2 } }],
        scopes: [{ response: { scopes: [{ name: 'Local', variablesReference: 4 }] } }],
        variables: [{ response: { variables: [{ name: 'only', value: 'null' }] } }],
        evaluate: [{ response: { result: 'plain' } }],
        setVariable: [{ response: { name: 'y', value: '3' } }],
        setExpression: [{ response: { result: 'ok' } }],
        completions: [{ response: { targets: [{ label: 'bare' }] } }],
        exceptionInfo: [{ response: { exceptionId: 'X' } }],
        modules: [{ response: { modules: [{ id: 'sym', name: 'mod' }] } }],
        loadedSources: [{ response: { sources: [{}] } }],
        source: [{ response: { content: 'c' } }],
        disassemble: [{ response: { instructions: [{ address: '0x9', instruction: 'nop' }] } }],
        readMemory: [{ response: {} }],
        writeMemory: [{ response: {} }],
        restartFrame: [{ response: {} }],
        stepBack: [{ response: {} }, { event: { name: 'stopped', body: { reason: 'step', threadId: 5 } } }],
        pause: [{ response: {} }],
        setBreakpoints: [{ response: { breakpoints: [{ id: 2, verified: true }] } }],
        setExceptionBreakpoints: [{ response: {} }],
        setFunctionBreakpoints: [{ response: { breakpoints: [{ id: 4, verified: true }] } }],
        setDataBreakpoints: [{ response: {} }],
        setInstructionBreakpoints: [{ response: {} }],
      })
      const backend = scripted.backend
      await backend.start({ launch: { request: 'launch' }, breakpoints: [{ source: 'a.ts', lines: [1] }], exceptionFilters: [], timeoutMs: 500 })

      const trace = await backend.stackTrace(DebugThreadId('5'), { startFrame: 0, levels: 1 })
      expect(trace).toMatchObject({ totalFrames: 2, truncated: true })
      expect(trace.frames[0]?.source).toBeUndefined()
      const scopes = await backend.scopes(trace.frames[0]?.id ?? DebugFrameId('3'))
      expect(scopes[0]).toMatchObject({ name: 'Local', variablesReference: DebugVariableReference('4'), expensive: false })
      const variables = await backend.variables(scopes[0]?.variablesReference ?? DebugVariableReference('4'), { start: 0, count: 5, filter: 'named' })
      expect(variables.variables[0]).toMatchObject({ name: 'only', value: 'null' })
      await expect(backend.evaluate('e', 'hover', undefined)).resolves.toMatchObject({ result: 'plain' })
      await expect(backend.setVariable(DebugVariableReference('4'), 'y', '3')).resolves.toMatchObject({ name: 'y', value: '3' })
      await expect(backend.setExpression('y', '3', undefined)).resolves.toMatchObject({ result: 'ok' })
      await expect(backend.completions('b', 1, undefined)).resolves.toEqual([{ label: 'bare' }])
      await expect(backend.exceptionInfo(DebugThreadId('5'))).resolves.toMatchObject({ exceptionId: 'X', breakMode: 'never' })
      const modules = await backend.modules()
      expect(modules.modules[0]).toMatchObject({ id: 'sym', name: 'mod' })
      expect(modules.truncated).toBe(false)
      await expect(backend.loadedSources()).resolves.toEqual([{ workspaceRelativePath: '', absolutePath: '' }])
      await expect(backend.source(DebugSourceReference('1'))).resolves.toEqual({ content: 'c' })
      await expect(backend.disassemble({ memoryReference: '0x9', instructionCount: 1, offset: 0, resolveSymbols: true })).resolves.toMatchObject({
        instructions: [{ address: '0x9', instruction: 'nop' }],
      })
      await expect(backend.readMemory({ memoryReference: '0x9', count: 2, offset: 0 })).resolves.toEqual(new Uint8Array(0))
      await expect(backend.writeMemory({ memoryReference: '0x9', data: '', offset: 0 })).resolves.toBeUndefined()
      await expect(backend.restartFrame(trace.frames[0]?.id ?? DebugFrameId('3'))).resolves.toBeUndefined()
      await expect(backend.step('back', DebugThreadId('5'), 'instruction')).resolves.toMatchObject({ kind: 'stopped', stop: { reason: 'step' } })
      await expect(backend.pause(DebugThreadId('5'))).resolves.toBeUndefined()
      const applied = await backend.setFunctionBreakpoints({ breakpoints: [{ name: 'f', condition: 'c', hitCondition: '2' }] })
      expect(applied.applied[0]).toMatchObject({ verified: true })
      await expect(backend.setDataBreakpoints({ breakpoints: [{ dataId: 'd', bytes: 4, condition: 'c', hitCondition: '1' }] })).resolves.toMatchObject({ applied: [], rejected: [] })
      await expect(backend.setInstructionBreakpoints({ breakpoints: [{ instructionReference: '0x1', offset: 1, condition: 'c', hitCondition: '1' }] })).resolves.toMatchObject({ applied: [], rejected: [] })
      await expect(backend.setFunctionBreakpoints({ breakpoints: [{ name: 'bare' }] })).resolves.toMatchObject({ applied: [{ verified: true }] })
      await expect(backend.setDataBreakpoints({ breakpoints: [{ dataId: 'bare' }] })).resolves.toMatchObject({ applied: [], rejected: [] })
      await expect(backend.setInstructionBreakpoints({ breakpoints: [{ instructionReference: '0x2' }] })).resolves.toMatchObject({ applied: [], rejected: [] })
      const breakpoints = await backend.setBreakpoints({
        source: { workspaceRelativePath: 'a.ts', absolutePath: '/x/a.ts' },
        breakpoints: [{ line: 1, column: 2, hitCondition: '3', logMessage: 'log' }],
      })
      expect(breakpoints.applied[0]).toMatchObject({ id: DebugBreakpointId('2'), requestedLine: 1, verified: true })
      const bare = await backend.setBreakpoints({
        source: { workspaceRelativePath: 'a.ts', absolutePath: '/x/a.ts' },
        breakpoints: [{ line: 2 }],
      })
      expect(bare.applied[0]).toMatchObject({ requestedLine: 2, verified: true })
    })

    it('defaults exception break modes it cannot map', async () => {
      const scripted = mountScripted({
        initialize: [{ response: { capabilities: { supportsExceptionInfoRequest: true } } }, { event: { name: 'initialized' } }],
        launch: [{ response: {} }, { event: { name: 'terminated' } }],
        exceptionInfo: [{ response: { exceptionId: 'E2', breakMode: 'sometimes' } }],
      })
      await scripted.backend.start(HANDSHAKE_PLAN)
      await expect(scripted.backend.exceptionInfo(DebugThreadId('1'))).resolves.toMatchObject({ exceptionId: 'E2', breakMode: 'never' })
    })
  })

  it('rejects undeclared capabilities before sending anything', async () => {
    const scripted = mountScripted({
      initialize: [{ response: { capabilities: {} } }, { event: { name: 'initialized' } }],
      launch: [{ response: {} }, { event: { name: 'terminated' } }],
    })
    const backend = scripted.backend
    await backend.start(HANDSHAKE_PLAN)
    await expect(backend.step('back')).rejects.toMatchObject({ code: 'DEBUG_UNSUPPORTED_CAPABILITY' })
    await expect(backend.setDataBreakpoints({ breakpoints: [{ dataId: 'x' }] })).rejects.toMatchObject({ code: 'DEBUG_UNSUPPORTED_CAPABILITY' })
    await expect(backend.setInstructionBreakpoints({ breakpoints: [{ instructionReference: '0x1' }] })).rejects.toMatchObject({ code: 'DEBUG_UNSUPPORTED_CAPABILITY' })
    await expect(backend.readMemory({ memoryReference: '0x1', count: 4 })).rejects.toMatchObject({ code: 'DEBUG_UNSUPPORTED_CAPABILITY' })
    await expect(backend.writeMemory({ memoryReference: '0x1', data: 'AAAA' })).rejects.toMatchObject({ code: 'DEBUG_UNSUPPORTED_CAPABILITY' })
    await expect(backend.disassemble({ memoryReference: '0x1', instructionCount: 2 })).rejects.toMatchObject({ code: 'DEBUG_UNSUPPORTED_CAPABILITY' })
    await expect(backend.completions('va', 2)).rejects.toMatchObject({ code: 'DEBUG_UNSUPPORTED_CAPABILITY' })
    await expect(backend.exceptionInfo(DebugThreadId('1'))).rejects.toMatchObject({ code: 'DEBUG_UNSUPPORTED_CAPABILITY' })
    await expect(backend.modules()).rejects.toMatchObject({ code: 'DEBUG_UNSUPPORTED_CAPABILITY' })
    await expect(backend.loadedSources()).rejects.toMatchObject({ code: 'DEBUG_UNSUPPORTED_CAPABILITY' })
    await expect(backend.setVariable(DebugVariableReference('2001'), 'x', '1')).rejects.toMatchObject({ code: 'DEBUG_UNSUPPORTED_CAPABILITY' })
    await expect(backend.setExpression('x', '1')).rejects.toMatchObject({ code: 'DEBUG_UNSUPPORTED_CAPABILITY' })
    await expect(backend.restartFrame(DebugFrameId('1000'))).rejects.toMatchObject({ code: 'DEBUG_UNSUPPORTED_CAPABILITY' })
    await expect(backend.restart()).rejects.toMatchObject({ code: 'DEBUG_UNSUPPORTED_CAPABILITY' })
    await expect(backend.terminate()).rejects.toMatchObject({ code: 'DEBUG_UNSUPPORTED_CAPABILITY' })
  })
})
