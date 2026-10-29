import { describe, expect, it } from 'vitest'
import { connect } from 'node:net'
import { once } from 'node:events'
import type { Duplex } from 'node:stream'
import { connectDebugTunnel } from '../src/tunnel.ts'
import { DapClient } from '../src/client.ts'
import { decodeDapFrames, encodeDapFrame } from '../src/frames.ts'

describe('debug tunnel transport', () => {
  it('carries frames over a connector-established stream', async () => {
    const server = await openEchoServer()
    const transport = await connectDebugTunnel(
      { connectTcpStream: async (host, port) => connect(port, host) },
      { host: server.host, port: server.port },
    )
    const client = new DapClient(transport)
    const response = client.request('threads', {})
    await server.answerNext()
    await expect(response).resolves.toMatchObject({ success: true, command: 'threads' })
    await client.dispose()
    await server.close()
  })

  it('rejects as attach-unsupported when the connector fails', async () => {
    await expect(connectDebugTunnel(
      { connectTcpStream: async () => {
        throw new Error('no route')
      } },
      { host: '10.255.255.1', port: 1 },
    )).rejects.toMatchObject({ code: 'DEBUG_ATTACH_UNSUPPORTED' })
    await expect(connectDebugTunnel(
      { connectTcpStream: async () => {
        throw 'plain-string failure'
      } },
      { host: '10.255.255.1', port: 1 },
    )).rejects.toMatchObject({ code: 'DEBUG_ATTACH_UNSUPPORTED' })
  })
})

interface EchoServer {
  readonly host: string
  readonly port: number
  answerNext(): Promise<void>
  close(): Promise<void>
}

async function openEchoServer(): Promise<EchoServer> {
  const { createServer } = await import('node:net')
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no listen address')
  let pending: Duplex | undefined
  server.on('connection', (socket) => {
    pending = socket
  })
  return {
    host: '127.0.0.1',
    port: address.port,
    async answerNext() {
      let socket = pending
      if (socket === undefined) {
        socket = (await once(server, 'connection'))[0] as Duplex
      }
      socket.once('data', (chunk: Uint8Array) => {
        const request = decodeDapFrames(chunk).messages[0]
        if (request === undefined || request.type !== 'request') throw new Error('no request frame')
        const seq = request.seq
        socket.write(encodeDapFrame({ seq, type: 'response', request_seq: seq, success: true, command: request.command, body: {} }))
      })
    },
    async close() {
      pending?.destroy()
      server.close()
      await once(server, 'close')
    },
  }
}
