import { describe, expect, it } from 'vitest'
import { decodeDapFrames, encodeDapFrame } from '../src/frames.ts'
import {
  createFakeDebugAdapter,
  FakeDebugAdapterCrashError,
  type DapMessage,
  type DapRequest,
  type DapResponse,
} from '../src/index.ts'

function request(seq: number, command: string, args?: DapRequest['arguments']): DapRequest {
  return { seq, type: 'request', command, ...(args === undefined ? {} : { arguments: args }) }
}

function response(seq: number, requestSeq: number, command: string): DapResponse {
  return { seq, type: 'response', request_seq: requestSeq, success: true, command }
}

async function readMessages(adapter: ReturnType<typeof createFakeDebugAdapter>, count: number): Promise<unknown[]> {
  const messages: unknown[] = []
  for (let i = 0; i < count; i += 1) messages.push(await adapter.read())
  return messages
}

describe('fake debug adapter', () => {
  it('answers initialize and emits initialized', async () => {
    const adapter = createFakeDebugAdapter()
    adapter.write(request(1, 'initialize', { clientID: 'test', linesStartAt1: true }))
    await expect(adapter.read()).resolves.toMatchObject({ type: 'response', success: true, command: 'initialize' })
    await expect(adapter.read()).resolves.toMatchObject({ type: 'event', event: 'initialized' })
  })

  it('declares default capabilities and honors script overrides', async () => {
    const adapter = createFakeDebugAdapter({ capabilities: { supportsStepBack: true } })
    adapter.write(request(1, 'initialize', {}))
    const initialized = await adapter.read()
    expect(initialized).toEqual(expect.objectContaining({
      type: 'response',
      success: true,
      body: {
        capabilities: {
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
          supportsStepBack: true,
        },
      },
    }))
  })

  it('stops at the first scripted breakpoint after launch', async () => {
    const adapter = createFakeDebugAdapter({ stops: [{ reason: 'breakpoint', threadId: 1, line: 4 }] })
    adapter.write(request(1, 'initialize', {}))
    await adapter.read()
    await adapter.read()
    adapter.write(request(2, 'launch', {}))
    await expect(adapter.read()).resolves.toMatchObject({ type: 'response', command: 'launch', success: true })
    await expect(adapter.read()).resolves.toMatchObject({ type: 'event', event: 'process' })
    await expect(adapter.read()).resolves.toMatchObject({
      type: 'event',
      event: 'stopped',
      body: { reason: 'breakpoint', threadId: 1, line: 4 },
    })
  })

  it('attaches to completion without stops and answers inspection at line 1', async () => {
    const adapter = createFakeDebugAdapter()
    adapter.write(request(1, 'initialize', {}))
    await readMessages(adapter, 2)
    adapter.write(request(2, 'configurationDone', {}))
    await expect(adapter.read()).resolves.toMatchObject({ type: 'response', command: 'configurationDone', success: true })
    adapter.write(request(3, 'attach', {}))
    await expect(adapter.read()).resolves.toMatchObject({ type: 'response', command: 'attach', success: true })
    await expect(adapter.read()).resolves.toMatchObject({ type: 'event', event: 'process', body: { startMethod: 'attach' } })
    await expect(adapter.read()).resolves.toMatchObject({ type: 'event', event: 'terminated' })
    adapter.write(request(4, 'stackTrace', { threadId: 1 }))
    await expect(adapter.read()).resolves.toMatchObject({
      type: 'response',
      command: 'stackTrace',
      body: { stackFrames: [{ id: 1000, line: 1, column: 1 }], totalFrames: 1 },
    })
  })

  it('emits one scripted stop at configurationDone and never a second one', async () => {
    const adapter = createFakeDebugAdapter({
      stops: [{ reason: 'entry', threadId: 1, line: 1 }],
      delayedEvent: { afterMs: 10, event: 'output', body: { category: 'stdout', output: 'sentinel' } },
    })
    adapter.write(request(1, 'initialize', {}))
    await readMessages(adapter, 2)
    adapter.write(request(2, 'setBreakpoints', { source: { path: '/ws/a.ts' }, breakpoints: [{ line: 4 }] }))
    await expect(adapter.read()).resolves.toMatchObject({
      type: 'response',
      command: 'setBreakpoints',
      body: { breakpoints: [{ id: 1000, verified: true, line: 4 }] },
    })
    adapter.write(request(3, 'setFunctionBreakpoints', { breakpoints: [{ name: 'main' }] }))
    await expect(adapter.read()).resolves.toMatchObject({
      type: 'response',
      command: 'setFunctionBreakpoints',
      body: { breakpoints: [{ id: 2000, verified: true }] },
    })
    adapter.write(request(4, 'setExceptionBreakpoints', { filters: ['all'] }))
    await expect(adapter.read()).resolves.toMatchObject({ type: 'response', command: 'setExceptionBreakpoints', success: true })
    adapter.write(request(5, 'configurationDone', {}))
    await expect(adapter.read()).resolves.toMatchObject({ type: 'response', command: 'configurationDone', success: true })
    await expect(adapter.read()).resolves.toMatchObject({ type: 'event', event: 'stopped', body: { reason: 'entry', line: 1 } })
    adapter.write(request(6, 'configurationDone', {}))
    adapter.write(request(7, 'launch', {}))
    await expect(adapter.read()).resolves.toMatchObject({ type: 'response', command: 'configurationDone', success: true })
    await expect(adapter.read()).resolves.toMatchObject({ type: 'response', command: 'launch', success: true })
    await expect(adapter.read()).resolves.toMatchObject({ type: 'event', event: 'process' })
    await expect(adapter.read()).resolves.toMatchObject({ type: 'event', event: 'output', body: { output: 'sentinel' } })
  })

  it('answers inspection requests with deterministic fixture data', async () => {
    const adapter = createFakeDebugAdapter({ stops: [{ reason: 'breakpoint', threadId: 1, line: 4, column: 7, description: 'hit a.ts:4' }] })
    adapter.write(request(1, 'initialize', {}))
    await readMessages(adapter, 2)
    adapter.write(request(2, 'launch', {}))
    await readMessages(adapter, 3)

    adapter.write(request(3, 'threads', {}))
    await expect(adapter.read()).resolves.toMatchObject({
      type: 'response',
      command: 'threads',
      body: { threads: [{ id: 1, name: 'main' }] },
    })

    adapter.write(request(4, 'stackTrace', { threadId: 1 }))
    await expect(adapter.read()).resolves.toMatchObject({
      type: 'response',
      command: 'stackTrace',
      body: {
        stackFrames: [{ id: 1000, name: 'fake frame', line: 4, column: 7, source: { path: '/ws/a.ts', name: 'a.ts' } }],
        totalFrames: 1,
      },
    })

    adapter.write(request(5, 'scopes', { frameId: 1000 }))
    await expect(adapter.read()).resolves.toMatchObject({
      type: 'response',
      command: 'scopes',
      body: {
        scopes: [
          { name: 'Locals', presentationHint: 'locals', variablesReference: 2001, expensive: false },
          { name: 'Globals', presentationHint: 'globals', variablesReference: 2002, expensive: true },
        ],
      },
    })

    adapter.write(request(6, 'variables', { variablesReference: 2001 }))
    await expect(adapter.read()).resolves.toMatchObject({
      type: 'response',
      command: 'variables',
      body: {
        variables: [
          { name: 'count', value: '1', type: 'number', variablesReference: 0 },
          { name: 'items', value: 'Array(2)', type: 'array', variablesReference: 3001 },
        ],
      },
    })

    adapter.write(request(7, 'variables', { variablesReference: 3001 }))
    await expect(adapter.read()).resolves.toMatchObject({
      body: { variables: [{ name: '0', value: '"alpha"', type: 'string', variablesReference: 0 }] },
    })

    adapter.write(request(8, 'variables', { variablesReference: 9999 }))
    await expect(adapter.read()).resolves.toMatchObject({ body: { variables: [] } })

    adapter.write(request(9, 'evaluate', { expression: '1+1', frameId: 1000 }))
    await expect(adapter.read()).resolves.toMatchObject({
      type: 'response',
      command: 'evaluate',
      body: { result: 'eval:1+1', type: 'string', variablesReference: 0 },
    })
  })

  it('advances the stop script on continue and step, then terminates', async () => {
    const adapter = createFakeDebugAdapter({ stops: [
      { reason: 'breakpoint', threadId: 1, line: 4 },
      { reason: 'step', threadId: 1, line: 5 },
    ] })
    adapter.write(request(1, 'initialize', {}))
    await readMessages(adapter, 2)
    adapter.write(request(2, 'launch', {}))
    await readMessages(adapter, 3)

    adapter.write(request(3, 'continue', { threadId: 1 }))
    await expect(adapter.read()).resolves.toMatchObject({
      type: 'response',
      command: 'continue',
      body: { allThreadsContinued: false },
    })
    await expect(adapter.read()).resolves.toMatchObject({ type: 'event', event: 'stopped', body: { reason: 'step', line: 5 } })

    adapter.write(request(4, 'next', { threadId: 1 }))
    await expect(adapter.read()).resolves.toMatchObject({ type: 'response', command: 'next', success: true })
    await expect(adapter.read()).resolves.toMatchObject({ type: 'event', event: 'terminated' })
  })

  it('pauses into a stop event without consuming the script', async () => {
    const adapter = createFakeDebugAdapter({ stops: [{ reason: 'breakpoint', threadId: 1, line: 4 }] })
    adapter.write(request(1, 'initialize', {}))
    await readMessages(adapter, 2)
    adapter.write(request(2, 'launch', {}))
    await readMessages(adapter, 3)
    adapter.write(request(3, 'pause', { threadId: 1 }))
    await expect(adapter.read()).resolves.toMatchObject({ type: 'response', command: 'pause', success: true })
    await expect(adapter.read()).resolves.toMatchObject({ type: 'event', event: 'stopped', body: { reason: 'pause' } })
  })

  it('restarts from the first scripted stop', async () => {
    const adapter = createFakeDebugAdapter({ stops: [{ reason: 'breakpoint', threadId: 1, line: 4 }] })
    adapter.write(request(1, 'initialize', {}))
    await readMessages(adapter, 2)
    adapter.write(request(2, 'launch', {}))
    await readMessages(adapter, 3)
    adapter.write(request(3, 'continue', { threadId: 1 }))
    await readMessages(adapter, 2)
    adapter.write(request(4, 'restart', {}))
    await expect(adapter.read()).resolves.toMatchObject({ type: 'response', command: 'restart', success: true })
    await expect(adapter.read()).resolves.toMatchObject({ type: 'event', event: 'process' })
    await expect(adapter.read()).resolves.toMatchObject({ type: 'event', event: 'stopped', body: { reason: 'breakpoint', line: 4 } })
  })

  it('responds to terminate with a terminated event and to disconnect with a response only', async () => {
    const adapter = createFakeDebugAdapter()
    adapter.write(request(1, 'initialize', {}))
    await readMessages(adapter, 2)
    adapter.write(request(2, 'terminate'))
    await expect(adapter.read()).resolves.toMatchObject({ type: 'response', command: 'terminate', success: true })
    await expect(adapter.read()).resolves.toMatchObject({ type: 'event', event: 'terminated' })
    adapter.write(request(3, 'disconnect'))
    await expect(adapter.read()).resolves.toMatchObject({ type: 'response', command: 'disconnect', success: true })
  })

  it('answers cancel and rejects unknown commands', async () => {
    const adapter = createFakeDebugAdapter()
    adapter.write(request(1, 'cancel', {}))
    await expect(adapter.read()).resolves.toMatchObject({ type: 'response', command: 'cancel', success: true })
    adapter.write(request(2, 'completions', {}))
    await expect(adapter.read()).resolves.toMatchObject({ type: 'response', command: 'completions', success: false })
  })

  it('never responds to hung commands while later requests still answer', async () => {
    const adapter = createFakeDebugAdapter({ hang: ['threads'] })
    adapter.write(request(1, 'initialize', {}))
    adapter.write(request(2, 'threads', {}))
    adapter.write(request(3, 'evaluate', { expression: '1+1' }))
    await expect(adapter.read()).resolves.toMatchObject({ type: 'response', command: 'initialize' })
    await expect(adapter.read()).resolves.toMatchObject({ type: 'event', event: 'initialized' })
    await expect(adapter.read()).resolves.toMatchObject({ type: 'response', command: 'evaluate' })
  })

  it('records debuggee stderr text on launch', async () => {
    const adapter = createFakeDebugAdapter({ stderr: 'debuggee boom' })
    adapter.write(request(1, 'initialize', {}))
    await readMessages(adapter, 2)
    expect(adapter.stderrText).toBe('')
    adapter.write(request(2, 'launch', {}))
    await readMessages(adapter, 3)
    expect(adapter.stderrText).toBe('debuggee boom')
  })

  it('emits a runInTerminal reverse request after launch and records the client response', async () => {
    const adapter = createFakeDebugAdapter({ runInTerminal: { args: ['node', 'app.js'] } })
    adapter.write(request(1, 'initialize', {}))
    await readMessages(adapter, 2)
    adapter.write(request(2, 'launch', {}))
    await expect(adapter.read()).resolves.toMatchObject({ type: 'response', command: 'launch', success: true })
    const reverse = await adapter.read()
    expect(reverse).toMatchObject({ type: 'request', command: 'runInTerminal', arguments: { kind: 'integrated', args: ['node', 'app.js'] } })
    adapter.write(response(99, reverse.seq, 'runInTerminal'))
    expect(adapter.reverseRequestResponses).toHaveLength(1)
    await expect(adapter.read()).resolves.toMatchObject({ type: 'event', event: 'process' })
    await expect(adapter.read()).resolves.toMatchObject({ type: 'event', event: 'terminated' })
  })

  it('ignores client responses that match no outstanding reverse request', async () => {
    const adapter = createFakeDebugAdapter()
    adapter.write(request(1, 'initialize', {}))
    await readMessages(adapter, 2)
    adapter.write(response(50, 999, 'runInTerminal'))
    expect(adapter.reverseRequestResponses).toHaveLength(0)
  })

  it('emits a delayed event after later request responses', async () => {
    const adapter = createFakeDebugAdapter({ delayedEvent: { afterMs: 5, event: 'output', body: { category: 'stdout', output: 'late' } } })
    adapter.write(request(1, 'initialize', {}))
    await readMessages(adapter, 2)
    adapter.write(request(3, 'evaluate', { expression: '2' }))
    await expect(adapter.read()).resolves.toMatchObject({ type: 'response', command: 'evaluate', success: true })
    await expect(adapter.read()).resolves.toMatchObject({ type: 'event', event: 'output', body: { output: 'late' } })
  })

  it('injects a malformed wire chunk that message reads skip', async () => {
    const adapter = createFakeDebugAdapter({ malformedAfter: ['initialize'] })
    adapter.write(request(1, 'initialize', {}))
    const responseFrame = await adapter.readWire()
    expect(decodeDapFrames(responseFrame).messages[0]).toMatchObject({ type: 'response', command: 'initialize' })
    await adapter.readWire()
    const malformed = await adapter.readWire()
    expect(() => decodeDapFrames(malformed)).toThrow(/JSON/)

    const skipping = createFakeDebugAdapter({ malformedAfter: ['initialize'] })
    skipping.write(request(1, 'initialize', {}))
    await expect(skipping.read()).resolves.toMatchObject({ type: 'response', command: 'initialize' })
    await expect(skipping.read()).resolves.toMatchObject({ type: 'event', event: 'initialized' })
    skipping.write(request(2, 'evaluate', { expression: '1' }))
    await expect(skipping.read()).resolves.toMatchObject({ type: 'response', command: 'evaluate' })
  })

  it('crashes on script, rejects pending and later reads, and still accepts writes', async () => {
    const adapter = createFakeDebugAdapter({ hang: ['launch'], crashAfter: 'launch' })
    adapter.write(request(1, 'initialize', {}))
    await readMessages(adapter, 2)
    const pending = adapter.read()
    adapter.write(request(2, 'launch', {}))
    await expect(pending).rejects.toBeInstanceOf(FakeDebugAdapterCrashError)
    expect(() => adapter.write(request(3, 'terminate', {}))).not.toThrow()
    await expect(adapter.readWire()).rejects.toBeInstanceOf(FakeDebugAdapterCrashError)

    const quiet = createFakeDebugAdapter({ crashAfter: 'launch' })
    quiet.write(request(1, 'initialize', {}))
    await readMessages(quiet, 2)
    quiet.write(request(2, 'launch', {}))
    await expect(quiet.read()).rejects.toBeInstanceOf(FakeDebugAdapterCrashError)
  })

  it('rejects request arguments that miss required fields', () => {
    const adapter = createFakeDebugAdapter()
    expect(() => adapter.write(request(1, 'setBreakpoints', { source: { path: '/ws/a.ts' } }))).toThrow(/breakpoints/)
    expect(() => adapter.write(request(2, 'setBreakpoints', { source: { path: '/ws/a.ts' }, breakpoints: [42] }))).toThrow(/object/)
    expect(() => adapter.write(request(3, 'setBreakpoints', { source: { path: '/ws/a.ts' }, breakpoints: [{}] }))).toThrow(/line/)
    expect(() => adapter.write(request(4, 'evaluate', { expression: 42 }))).toThrow(/expression/)
    expect(() => adapter.write(request(5, 'variables', {}))).toThrow(/variablesReference/)
  })
})

describe('fake adapter frame codec', () => {
  it('round-trips messages and keeps a partial tail', () => {
    const first = { seq: 1, type: 'response', request_seq: 1, success: true, command: 'initialize' } satisfies DapMessage
    const second = { seq: 2, type: 'event', event: 'initialized' } satisfies DapMessage
    const encodedFirst = encodeDapFrame(first)
    expect(encodedFirst.subarray(0, 16)).toEqual(new TextEncoder().encode('Content-Length: '))
    const decodedBoth = decodeDapFrames(Buffer.concat([encodedFirst, encodeDapFrame(second)]))
    expect(decodedBoth.messages).toEqual([first, second])
    expect(decodedBoth.rest).toHaveLength(0)

    const partial = decodeDapFrames(encodedFirst.subarray(0, 12))
    expect(partial.messages).toEqual([])
    const completed = decodeDapFrames(Buffer.concat([partial.rest, encodedFirst.subarray(12)]))
    expect(completed.messages).toEqual([first])

    const bodyTruncated = decodeDapFrames(encodedFirst.subarray(0, encodedFirst.length - 5))
    expect(bodyTruncated.messages).toEqual([])
    expect(bodyTruncated.rest).toHaveLength(encodedFirst.length - 5)
  })

  it('rejects invalid headers and invalid JSON bodies', () => {
    expect(() => decodeDapFrames(new TextEncoder().encode('Content-Length: nope\r\n\r\n{}'))).toThrow(/Content-Length/)
    expect(() => decodeDapFrames(new TextEncoder().encode('Content-Length: 4\r\n\r\noops'))).toThrow(/JSON/)
    expect(() => decodeDapFrames(new TextEncoder().encode('Content-Length: 4\r\n\r\nnull'))).toThrow(/object/)
    expect(() => decodeDapFrames(new TextEncoder().encode('Content-Length: 3\r\n\r\n[1]'))).toThrow(/type/)
  })
})
