import { describe, expect, it } from 'vitest'
import { createFakeDebugAdapter } from '@deepseek-ai/dsh-fake-debug-adapter'
import { DebugThreadId } from '@deepseek-ai/dsh-debug'
import type { JsonValue } from '@deepseek-ai/dsh-debug'
import { createMemoryTransport } from './memory-transport.ts'
import { DapClient } from '../src/client.ts'
import { decodeDapFrames, encodeDapFrame, type DapRequest } from '../src/frames.ts'
import type { DebugTransport } from '../src/transport.ts'
import { initializeDebugAdapter, mapStopReason } from '../src/handshake.ts'
import { mapCapabilities } from '../src/capabilities.ts'

interface ScriptedTransport {
  readonly transport: DebugTransport
  readonly sentCommands: readonly string[]
}

function createScriptedTransport(script: Readonly<Record<string, readonly Uint8Array[]>>): ScriptedTransport {
  const waiters: { resolve: (result: IteratorResult<Uint8Array>) => void }[] = []
  const queued: IteratorResult<Uint8Array>[] = []
  const sentCommands: string[] = []
  const deliver = (bytes: Uint8Array): void => {
    const waiter = waiters.shift()
    if (waiter === undefined) {
      queued.push({ done: false, value: bytes })
      return
    }
    waiter.resolve({ done: false, value: bytes })
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
    async write(bytes) {
      for (const message of decodeDapFrames(bytes).messages) {
        if (message.type !== 'request') continue
        const request = message as DapRequest
        sentCommands.push(request.command)
        for (const frame of script[request.command] ?? []) deliver(frame)
      }
    },
    async end() {},
  }
  return { transport, sentCommands }
}

function responseFrame(requestSeq: number, command: string, success: boolean, body: JsonValue | undefined, message?: string): Uint8Array {
  return encodeDapFrame({
    seq: requestSeq * 100,
    type: 'response',
    request_seq: requestSeq,
    success,
    command,
    ...(body === undefined ? {} : { body }),
    ...(message === undefined ? {} : { message }),
  })
}

function eventFrame(event: string, body?: JsonValue): Uint8Array {
  return encodeDapFrame({ seq: 900 + event.length, type: 'event', event, ...(body === undefined ? {} : { body }) })
}

describe('DAP handshake', () => {
  it('initializes, configures breakpoints, launches, and waits for the first stop', async () => {
    const adapter = createFakeDebugAdapter({ stops: [{ reason: 'breakpoint', threadId: 1, line: 4, description: 'hit a.ts:4' }] })
    const client = new DapClient(createMemoryTransport(adapter))
    const result = await initializeDebugAdapter(client, {
      adapterArgs: ['--server=1'],
      launch: { request: 'launch', program: '/ws/a.ts', cwd: '/ws' },
      breakpoints: [{ source: 'src/a.ts', lines: [4] }],
      timeoutMs: 1000,
    })
    expect(result.capabilities.supportsConditionalBreakpoints).toBe(true)
    expect(result.firstStop).toMatchObject({ reason: 'breakpoint', threadId: DebugThreadId('1'), description: 'hit a.ts:4' })
    await client.dispose()
  })

  it('skips configurationDone when the adapter did not declare it', async () => {
    const scripted = createScriptedTransport({
      initialize: [responseFrame(1, 'initialize', true, { capabilities: {} }), eventFrame('initialized')],
      attach: [responseFrame(2, 'attach', true, {}), eventFrame('terminated')],
    })
    const client = new DapClient(scripted.transport)
    const result = await initializeDebugAdapter(client, {
      launch: { request: 'attach' },
      timeoutMs: 1000,
    })
    expect(scripted.sentCommands).toEqual(['initialize', 'attach'])
    expect(result.firstStop).toBeUndefined()
    await client.dispose()
  })

  it('reads spec-form initialize bodies whose body is the capability record', async () => {
    const scripted = createScriptedTransport({
      initialize: [responseFrame(1, 'initialize', true, { supportsTerminateRequest: true, supportsConfigurationDoneRequest: true }), eventFrame('initialized')],
      configurationDone: [responseFrame(2, 'configurationDone', true, {})],
      attach: [responseFrame(3, 'attach', true, {}), eventFrame('terminated')],
    })
    const client = new DapClient(scripted.transport)
    const result = await initializeDebugAdapter(client, {
      launch: { request: 'attach' },
      timeoutMs: 1000,
    })
    expect(scripted.sentCommands).toEqual(['initialize', 'configurationDone', 'attach'])
    expect(result.capabilities.supportsTerminateRequest).toBe(true)
    await client.dispose()
  })

  it('resolves without a stop when the adapter terminates after attach', async () => {
    const adapter = createFakeDebugAdapter({ capabilities: { supportsConfigurationDoneRequest: false } })
    const client = new DapClient(createMemoryTransport(adapter))
    const result = await initializeDebugAdapter(client, {
      launch: { request: 'attach' },
      exceptionFilters: ['all'],
      timeoutMs: 1000,
    })
    expect(result.firstStop).toBeUndefined()
    await client.dispose()
  })

  it('rejects as launch-failed when the adapter rejects a request', async () => {
    const adapter = createFakeDebugAdapter({ fail: ['initialize'] })
    const client = new DapClient(createMemoryTransport(adapter))
    await expect(initializeDebugAdapter(client, {
      launch: { request: 'launch' },
      timeoutMs: 1000,
    })).rejects.toMatchObject({ code: 'DEBUG_LAUNCH_FAILED' })
    await client.dispose()

    const failing = createFakeDebugAdapter({ fail: ['launch'] })
    const failingClient = new DapClient(createMemoryTransport(failing))
    await expect(initializeDebugAdapter(failingClient, {
      launch: { request: 'launch' },
      timeoutMs: 1000,
    })).rejects.toMatchObject({ code: 'DEBUG_LAUNCH_FAILED' })
    await failingClient.dispose()
  })

  it('rejects a non-positive timeout as invalid configuration', async () => {
    const adapter = createFakeDebugAdapter()
    const client = new DapClient(createMemoryTransport(adapter))
    await expect(initializeDebugAdapter(client, {
      launch: { request: 'launch' },
      timeoutMs: 0,
    })).rejects.toMatchObject({ code: 'DEBUG_INVALID_CONFIG' })
    await client.dispose()
  })

  it('times out when the adapter never emits initialized', async () => {
    const scripted = createScriptedTransport({
      initialize: [responseFrame(1, 'initialize', true, 'not-a-record')],
    })
    const client = new DapClient(scripted.transport)
    await expect(initializeDebugAdapter(client, {
      launch: { request: 'launch' },
      timeoutMs: 10,
    })).rejects.toMatchObject({ code: 'DEBUG_TIMEOUT' })
    await client.dispose()
  })

  it('times out waiting for the first stop after launch', async () => {
    const scripted = createScriptedTransport({
      initialize: [responseFrame(1, 'initialize', true, { capabilities: { supportsConfigurationDoneRequest: true } }), eventFrame('initialized')],
      setBreakpoints: [responseFrame(2, 'setBreakpoints', true, {})],
      configurationDone: [responseFrame(3, 'configurationDone', true, {})],
      launch: [responseFrame(4, 'launch', true, {})],
    })
    const client = new DapClient(scripted.transport)
    await expect(initializeDebugAdapter(client, {
      launch: { request: 'launch' },
      breakpoints: [{ source: 'a.ts', lines: [1] }],
      timeoutMs: 15,
    })).rejects.toMatchObject({ code: 'DEBUG_TIMEOUT' })
    await client.dispose()
  })

  it('skips non-matching events and rejects non-object stop bodies', async () => {
    const scripted = createScriptedTransport({
      initialize: [
        responseFrame(1, 'initialize', true, { capabilities: {} }),
        eventFrame('output', { output: 'noise' }),
        eventFrame('initialized'),
      ],
      launch: [responseFrame(2, 'launch', true, {}), eventFrame('stopped', ['not', 'an', 'object'])],
    })
    const client = new DapClient(scripted.transport)
    await expect(initializeDebugAdapter(client, {
      launch: { request: 'launch' },
      timeoutMs: 200,
    })).rejects.toMatchObject({ code: 'DEBUG_MALFORMED_RESPONSE' })
    await client.dispose()
  })

  it('rejects a stopped event without a numeric threadId as malformed', async () => {
    const scripted = createScriptedTransport({
      initialize: [responseFrame(1, 'initialize', true, { capabilities: {} }), eventFrame('initialized')],
      launch: [responseFrame(2, 'launch', true, {}), eventFrame('stopped', { reason: 'breakpoint' })],
    })
    const client = new DapClient(scripted.transport)
    await expect(initializeDebugAdapter(client, {
      launch: { request: 'launch' },
      timeoutMs: 200,
    })).rejects.toMatchObject({ code: 'DEBUG_MALFORMED_RESPONSE' })
    await client.dispose()
  })

  it('defaults capabilities when the initialize body carries none', async () => {
    const scripted = createScriptedTransport({
      initialize: [responseFrame(1, 'initialize', true, {}), eventFrame('initialized')],
      attach: [responseFrame(2, 'attach', true, {}), eventFrame('terminated')],
    })
    const client = new DapClient(scripted.transport)
    const result = await initializeDebugAdapter(client, {
      launch: { request: 'attach' },
      timeoutMs: 100,
    })
    expect(result.capabilities.supportsTerminateRequest).toBe(false)
    expect(result.firstStop).toBeUndefined()
    await client.dispose()
  })
})

describe('capability mapping', () => {
  it('preserves known true flags and defaults missing ones to false', () => {
    expect(mapCapabilities({ supportsConditionalBreakpoints: true }).supportsConditionalBreakpoints).toBe(true)
    expect(mapCapabilities({}).supportsDataBreakpoints).toBe(false)
    expect(mapCapabilities(undefined).supportsStepBack).toBe(false)
  })

  it('ignores non-flag values, unknown fields, and non-record payloads', () => {
    const mapped = mapCapabilities({ supportsTerminateRequest: 'yes', futureCapabilityX: true })
    expect(mapped.supportsTerminateRequest).toBe(false)
    expect(mapped.supportsWriteMemoryRequest).toBe(false)
    expect(mapCapabilities(null).supportsRestartRequest).toBe(false)
    expect(mapCapabilities([true]).supportsLogPoints).toBe(false)
    expect(mapCapabilities(42).supportsStepBack).toBe(false)
  })
})

describe('stop reason mapping', () => {
  it('maps adapter reasons onto the closed union', () => {
    expect(mapStopReason('breakpoint')).toBe('breakpoint')
    expect(mapStopReason('data breakpoint')).toBe('dataBreakpoint')
    expect(mapStopReason('instruction breakpoint')).toBe('instructionBreakpoint')
    expect(mapStopReason('restart')).toBe('restart')
    expect(mapStopReason('goto')).toBe('unknown')
    expect(mapStopReason(undefined)).toBe('unknown')
    expect(mapStopReason(7)).toBe('unknown')
  })
})
