import { describe, expect, it, vi } from 'vitest'
import { createFakeDebugAdapter, type FakeDebugAdapter } from '@deepseek-ai/dsh-fake-debug-adapter'
import { createMemoryTransport } from './memory-transport.ts'
import { DapClient } from '../src/client.ts'
import { encodeDapFrame, MAX_MESSAGE_BYTES, type DebugTransport } from '../src/frames.ts'

interface PushTransport {
  readonly transport: DebugTransport
  push(bytes: Uint8Array): void
  endInput(): void
  failInput(): void
}

function createPushTransport(options: { readonly failWrites?: boolean; readonly failReturn?: boolean } = {}): PushTransport {
  const waiters: { resolve: (result: IteratorResult<Uint8Array>) => void; reject: (error: Error) => void }[] = []
  const queued: IteratorResult<Uint8Array>[] = []
  let inputEnded = false
  const transport: DebugTransport = {
    input: {
      [Symbol.asyncIterator]() {
        return {
          next() {
            const ready = queued.shift()
            if (ready !== undefined) return Promise.resolve(ready)
            if (inputEnded) return Promise.resolve({ done: true, value: undefined })
            return new Promise<IteratorResult<Uint8Array>>((resolve, reject) => {
              waiters.push({ resolve, reject })
            })
          },
          return: () => {
            if (options.failReturn === true) return Promise.reject(new Error('return failed'))
            return Promise.resolve({ done: true, value: undefined })
          },
        }
      },
    },
    async write() {
      if (options.failWrites === true) throw new Error('broken pipe')
    },
    async end() {},
  }
  return {
    transport,
    push(bytes) {
      const waiter = waiters.shift()
      if (waiter === undefined) {
        queued.push({ done: false, value: bytes })
        return
      }
      waiter.resolve({ done: false, value: bytes })
    },
    endInput() {
      inputEnded = true
      for (const waiter of waiters.splice(0)) waiter.resolve({ done: true, value: undefined })
    },
    failInput() {
      for (const waiter of waiters.splice(0)) waiter.reject(new Error('socket reset'))
    },
  }
}

function mount(script?: Parameters<typeof createFakeDebugAdapter>[0]): { adapter: FakeDebugAdapter; client: DapClient } {
  const adapter = createFakeDebugAdapter(script)
  return { adapter, client: new DapClient(createMemoryTransport(adapter)) }
}

describe('DapClient', () => {
  it('matches a response to its request and dispatches events', async () => {
    const { client } = mount()
    const events: string[] = []
    client.onEvent(event => events.push(event.event))
    await expect(client.request('initialize', { clientID: 'dsh', linesStartAt1: true })).resolves.toMatchObject({ success: true })
    await expect(client.request('disconnect')).resolves.toMatchObject({ success: true })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(events).toContain('initialized')
    await client.dispose()
  })

  it('reassembles frames split across chunks and honors disposers', async () => {
    const pushed = createPushTransport()
    const client = new DapClient(pushed.transport)
    const seen: string[] = []
    client.onEvent(event => seen.push(event.event))()
    client.onReverseRequest(async () => ({}))()

    const frame = encodeDapFrame({ seq: 1, type: 'response', request_seq: 1, success: true, command: 'threads' })
    const pending = client.request('threads')
    pushed.push(frame.subarray(0, 10))
    pushed.push(frame.subarray(10))
    await expect(pending).resolves.toMatchObject({ success: true })
    expect(seen).toEqual([])
    await client.dispose()
  })

  it('rejects a request on timeout and on abort', async () => {
    const { client } = mount({ hang: ['threads'] })
    await expect(client.request('threads', {}, AbortSignal.timeout(5)))
      .rejects.toMatchObject({ code: 'DEBUG_TIMEOUT' })
    const controller = new AbortController()
    const pending = client.request('threads', {}, controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'DEBUG_TIMEOUT' })
    await expect(client.request('threads', {}, AbortSignal.abort())).rejects.toMatchObject({ code: 'DEBUG_TIMEOUT' })
    await client.dispose()
  })

  it('rejects remaining requests when disposed and tolerates repeated disposal', async () => {
    const { client } = mount({ hang: ['threads'] })
    const pending = client.request('threads', {})
    await client.dispose()
    await expect(pending).rejects.toMatchObject({ code: 'DEBUG_SESSION_GONE' })
    await expect(client.dispose()).resolves.toBeUndefined()
    await expect(client.request('threads', {})).rejects.toMatchObject({ code: 'DEBUG_SESSION_GONE' })
  })

  it('contains iterator teardown failures during disposal', async () => {
    const pushed = createPushTransport({ failReturn: true })
    const client = new DapClient(pushed.transport)
    await expect(client.dispose()).resolves.toBeUndefined()
  })

  it('maps input stream failures to session-gone', async () => {
    const pushed = createPushTransport()
    const client = new DapClient(pushed.transport)
    const pending = client.request('threads', {})
    pushed.failInput()
    await expect(pending).rejects.toMatchObject({ code: 'DEBUG_SESSION_GONE' })
    await client.dispose()
  })

  it('contains transport failures while answering reverse requests', async () => {
    const pushed = createPushTransport({ failWrites: true })
    const client = new DapClient(pushed.transport)
    const commands: string[] = []
    client.onReverseRequest(async (request) => {
      commands.push(request.command)
      return {}
    })
    pushed.push(encodeDapFrame({ seq: 1, type: 'request', command: 'runInTerminal', arguments: {} }))
    await vi.waitFor(() => expect(commands).toEqual(['runInTerminal']))
    await new Promise(resolve => setTimeout(resolve, 5))
    await client.dispose()
  })

  it('maps adapter exit to session-gone for pending and later requests', async () => {
    const { client } = mount({ hang: ['threads'], crashAfter: 'launch' })
    const hung = client.request('threads', {})
    const launch = client.request('launch', {})
    await expect(hung).rejects.toMatchObject({ code: 'DEBUG_SESSION_GONE' })
    await expect(launch).rejects.toMatchObject({ code: 'DEBUG_SESSION_GONE' })
    await expect(client.request('threads', {})).rejects.toMatchObject({ code: 'DEBUG_SESSION_GONE' })
    await client.dispose()
  })

  it('fails pending requests and dies on malformed frames', async () => {
    const { client } = mount({ hang: ['evaluate'], malformedAfter: ['initialize'] })
    const hung = client.request('evaluate', { expression: '1' })
    await expect(client.request('initialize', {})).resolves.toMatchObject({ success: true })
    await expect(hung).rejects.toMatchObject({ code: 'DEBUG_MALFORMED_RESPONSE' })
    await expect(client.request('threads', {})).rejects.toMatchObject({ code: 'DEBUG_MALFORMED_RESPONSE' })
    await client.dispose()
  })

  it('dies on a response that matches no pending request', async () => {
    const pushed = createPushTransport()
    const client = new DapClient(pushed.transport)
    const pending = client.request('threads', {})
    pushed.push(encodeDapFrame({ seq: 1, type: 'response', request_seq: 999, success: true, command: 'threads' }))
    await expect(pending).rejects.toMatchObject({ code: 'DEBUG_MALFORMED_RESPONSE' })
    await client.dispose()
  })

  it('dies when separator-less input exceeds the frame budget', async () => {
    const pushed = createPushTransport()
    const client = new DapClient(pushed.transport)
    pushed.push(new Uint8Array(MAX_MESSAGE_BYTES + 4096))
    await expect(client.request('threads', {})).rejects.toMatchObject({ code: 'DEBUG_MALFORMED_RESPONSE' })
    await client.dispose()
  })

  it('rejects requests as session-gone when the transport write fails', async () => {
    const pushed = createPushTransport({ failWrites: true })
    const client = new DapClient(pushed.transport)
    await expect(client.request('threads', {})).rejects.toMatchObject({ code: 'DEBUG_SESSION_GONE' })
    await client.dispose()
  })

  it('dispatches reverse requests through handlers and records responses', async () => {
    const { adapter, client } = mount({ runInTerminal: { args: ['node', 'app.js'] } })
    const commands: string[] = []
    client.onReverseRequest(async (request) => {
      commands.push(request.command)
      return { processId: 4242 }
    })
    await expect(client.request('initialize', {})).resolves.toMatchObject({ success: true })
    await expect(client.request('launch', {})).resolves.toMatchObject({ success: true })
    await vi.waitFor(() => expect(adapter.reverseRequestResponses).toHaveLength(1))
    expect(adapter.reverseRequestResponses[0]).toMatchObject({ success: true, command: 'runInTerminal', body: { processId: 4242 } })
    expect(commands).toEqual(['runInTerminal'])
    await client.dispose()
  })

  it('answers reverse requests with failure when the handler rejects', async () => {
    const { adapter, client } = mount({ runInTerminal: { args: ['node', 'app.js'] } })
    client.onReverseRequest(async () => {
      throw new Error('no terminal service')
    })
    await client.request('launch', {})
    await vi.waitFor(() => expect(adapter.reverseRequestResponses).toHaveLength(1))
    expect(adapter.reverseRequestResponses[0]).toMatchObject({ success: false })
    await client.dispose()
  })

  it('answers unhandled reverse requests with an unsupported response', async () => {
    const { adapter, client } = mount({ runInTerminal: { args: ['node', 'app.js'] } })
    await client.request('launch', {})
    await vi.waitFor(() => expect(adapter.reverseRequestResponses).toHaveLength(1))
    expect(adapter.reverseRequestResponses[0]).toMatchObject({ success: false, message: expect.stringMatching(/unsupported/) })
    await client.dispose()
  })

  it('contains event listener failures', async () => {
    const { client } = mount()
    const seen: string[] = []
    client.onEvent(() => {
      throw new Error('listener exploded')
    })
    client.onEvent(event => seen.push(event.event))
    await client.request('initialize', {})
    await vi.waitFor(() => expect(seen).toContain('initialized'))
    await expect(client.request('threads', {})).resolves.toMatchObject({ success: true })
    await client.dispose()
  })
})
