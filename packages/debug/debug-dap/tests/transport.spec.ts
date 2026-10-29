import { describe, expect, it } from 'vitest'
import { connect, createServer } from 'node:net'
import { PassThrough, Writable, type Duplex } from 'node:stream'
import { once } from 'node:events'
import { createStdioTransport, createTunnelTransport, type DebugTransport } from '../src/transport.ts'

async function collectChunks(transport: DebugTransport, count: number): Promise<Uint8Array[]> {
  const chunks: Uint8Array[] = []
  const iterator = transport.input[Symbol.asyncIterator]()
  for (;;) {
    const result = await iterator.next()
    if (result.done) break
    chunks.push(result.value)
    if (chunks.length === count) break
  }
  return chunks
}

describe('stdio transport', () => {
  it('round-trips frames through the adapter pipes', async () => {
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    const transport = createStdioTransport({ stdin, stdout })
    const written = new Promise<Uint8Array>((resolve) => { stdin.once('data', (chunk) => { resolve(chunk as Uint8Array) }) })
    const bytes = new TextEncoder().encode('frame-bytes')
    await transport.write(bytes)
    expect(new Uint8Array(await written)).toEqual(bytes)

    const pushed = new TextEncoder().encode('adapter-bytes')
    stdout.write(pushed)
    const [received] = await collectChunks(transport, 1)
    if (received === undefined) throw new Error('stdio transport produced no chunk')
    expect(Buffer.compare(Buffer.from(received), Buffer.from(pushed))).toBe(0)
    await transport.end()
    expect(stdin.writableEnded).toBe(true)
  })

  it('waits for drain before resolving a write', async () => {
    const releases: (() => void)[] = []
    const stdin = new Writable({
      highWaterMark: 1,
      write(_chunk, _encoding, callback) {
        releases.push(callback)
      },
    })
    const transport = createStdioTransport({ stdin, stdout: new PassThrough() })
    let settled = false
    const pending = transport.write(new TextEncoder().encode('large-payload')).then(() => {
      settled = true
    })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(settled).toBe(false)
    for (const release of releases.splice(0)) release()
    await pending
    expect(settled).toBe(true)
    await transport.end()
  })

  it('rejects a write when the stream reports an error', async () => {
    const failure = new Error('write failed')
    const stdin = new Writable({
      write(_chunk, _encoding, callback) {
        callback(failure)
      },
    })
    const transport = createStdioTransport({ stdin, stdout: new PassThrough() })
    stdin.once('error', () => {})
    await expect(transport.write(new TextEncoder().encode('x'))).rejects.toBe(failure)
  })

  it('rejects end when the stream already failed', async () => {
    const stdin = new PassThrough()
    stdin.destroy(new Error('already broken'))
    const transport = createStdioTransport({ stdin, stdout: new PassThrough() })
    stdin.once('error', () => {})
    await expect(transport.end()).rejects.toThrow(/destroyed/)
  })

  it('rejects end when finishing the stream fails', async () => {
    const stdin = new Writable({
      write(_chunk, _encoding, callback) {
        callback()
      },
      final(callback) {
        callback(new Error('final flush failed'))
      },
    })
    const transport = createStdioTransport({ stdin, stdout: new PassThrough() })
    stdin.once('error', () => {})
    await expect(transport.end()).rejects.toThrow(/final flush failed/)
  })
})

describe('tunnel transport', () => {
  it('carries frames over a connected socket and half-closes it', async () => {
    const server = createServer()
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (typeof address !== 'object' || address === null) throw new Error('no listen address')
    const socket = connect(address.port, '127.0.0.1')
    await once(socket, 'connect')
    const serverSocket = (await once(server, 'connection'))[0] as Duplex

    const transport = createTunnelTransport(socket)
    const bytes = new TextEncoder().encode('tunnel-frame')
    const received = new Promise<Uint8Array>((resolve) => { serverSocket.once('data', (chunk) => { resolve(chunk as Uint8Array) }) })
    await transport.write(bytes)
    expect(new Uint8Array(await received)).toEqual(bytes)

    const answer = new TextEncoder().encode('tunnel-answer')
    serverSocket.write(answer)
    const [fromServer] = await collectChunks(transport, 1)
    if (fromServer === undefined) throw new Error('tunnel transport produced no chunk')
    expect(Buffer.compare(Buffer.from(fromServer), Buffer.from(answer))).toBe(0)

    await transport.end()
    await once(serverSocket, 'end')
    socket.destroy()
    serverSocket.destroy()
    server.close()
    await once(server, 'close')
  })
})
