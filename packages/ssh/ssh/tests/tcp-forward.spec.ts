/**
 * SSH TCP forwarding: validated targets, the wire request shape through the
 * helper protocol, and a helper-side stream that reaches the dialed TCP port.
 */

import { once } from 'node:events'
import { createServer, createConnection, type Socket } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { PassThrough } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { streamEndpointSchema, tcpTargetSchema } from '../src/schemas.ts'
import { SshRpcPeer } from '../src/protocol.ts'
import { RemoteProcesses } from '../src/helper-processes.ts'
import type { SshStreamEndpoint } from '../src/schemas.ts'
import { authenticateStream } from '../src/stream-security.ts'

describe('tcp target validation', () => {
  it('accepts host and port and rejects malformed targets', () => {
    expect(tcpTargetSchema.parse({ host: '127.0.0.1', port: 9229 })).toEqual({ host: '127.0.0.1', port: 9229 })
    expect(() => tcpTargetSchema.parse({ host: '', port: 1 })).toThrow()
    expect(() => tcpTargetSchema.parse({ host: 'a b', port: 1 })).toThrow()
    expect(() => tcpTargetSchema.parse({ host: 'h\nk', port: 1 })).toThrow()
    expect(() => tcpTargetSchema.parse({ host: 'host', port: 0 })).toThrow()
    expect(() => tcpTargetSchema.parse({ host: 'host', port: 65536 })).toThrow()
    expect(() => tcpTargetSchema.parse({ host: 'host', port: 1.5 })).toThrow()
    expect(() => tcpTargetSchema.parse({ host: 'host' })).toThrow()
  })
})

describe('tcp.prepare wire shape', () => {
  it('forwards the method and validated params through the helper protocol', async () => {
    const clientSide = new PassThrough()
    const helperSide = new PassThrough()
    const seen: Array<{ method: string; params: unknown }> = []
    const endpoint: SshStreamEndpoint = { path: '/tmp/ep', capability: 'a'.repeat(64) }
    new SshRpcPeer(helperSide, clientSide, 1024, 1, async (method, params) => {
      seen.push({ method, params })
      return endpoint
    })
    const client = new SshRpcPeer(clientSide, helperSide, 1024, 1)
    const result = await client.request('tcp.prepare', tcpTargetSchema.parse({ host: 'db.internal', port: 5432 }), streamEndpointSchema, undefined)
    expect(result).toEqual(endpoint)
    expect(seen).toEqual([{ method: 'tcp.prepare', params: { host: 'db.internal', port: 5432 } }])
  })
})

describe('helper-side tcp streams', () => {
  it('dials the target port and pipes bytes through the authenticated stream', async () => {
    const target = createServer()
    target.listen(0, '127.0.0.1')
    await once(target, 'listening')
    const address = target.address()
    if (typeof address !== 'object' || address === null) throw new Error('no listen address')
    let spoke: Socket | undefined
    target.on('connection', (socket) => {
      spoke = socket
      socket.on('data', data => socket.write(data))
    })

    const root = await mkdtemp('/tmp/dsh-ssh-tcp-')
    const ctx = new Context()
    const owner = new RemoteProcesses(ctx, root, 1, 10_000)
    try {
      const endpoint = await owner.prepareTcp({ host: '127.0.0.1', port: address.port })
      expect(typeof endpoint.path).toBe('string')

      const raw = createConnection({ path: endpoint.path, allowHalfOpen: true })
      await once(raw, 'connect')
      const stream = await authenticateStream(raw, endpoint.capability, 5000)
      stream.on('error', () => {})
      // authenticateStream returns a paused stream; attach the consumer, then resume.
      stream.resume()
      stream.write('ping')
      const echoed = await once(stream, 'data')
      expect(String(echoed[0])).toBe('ping')
      stream.end()
    } finally {
      await owner.close().catch(() => {})
      spoke?.destroy()
      target.close()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects malformed tcp targets loud', async () => {
    const root = await mkdtemp('/tmp/dsh-ssh-tcp-')
    const ctx = new Context()
    const owner = new RemoteProcesses(ctx, root, 1, 10_000)
    try {
      await expect(owner.prepareTcp({ host: 'no space', port: 1 })).rejects.toThrow()
      await expect(owner.prepareTcp({ host: 'ok', port: 0 })).rejects.toThrow()
    } finally {
      await owner.close().catch(() => {})
      await rm(root, { recursive: true, force: true })
    }
  })
})
