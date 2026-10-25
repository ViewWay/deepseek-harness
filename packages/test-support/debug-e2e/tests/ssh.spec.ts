import { describe, expect, it } from 'vitest'
import { connectDebugTunnel } from '@deepseek-ai/dsh-debug-dap'

describe('ssh debug e2e (fixture stub)', () => {
  it('rejects as attach-unsupported without a reachable ssh world', async () => {
    await expect(connectDebugTunnel(
      { connectTcpStream: async () => {
        throw new Error('ssh world fixture not wired yet')
      } },
      { host: '127.0.0.1', port: 1 },
    )).rejects.toMatchObject({ code: 'DEBUG_ATTACH_UNSUPPORTED' })
  })
})
