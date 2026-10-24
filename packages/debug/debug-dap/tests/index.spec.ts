import { describe, expect, it } from 'vitest'
import * as dap from '../src/index.ts'

describe('debug-dap public surface', () => {
  it('exports the frame codec, transports, and request client', () => {
    expect(typeof dap.encodeDapFrame).toBe('function')
    expect(typeof dap.decodeDapFrames).toBe('function')
    expect(typeof dap.createStdioTransport).toBe('function')
    expect(typeof dap.createTunnelTransport).toBe('function')
    expect(typeof dap.DapClient).toBe('function')
    expect(dap.MAX_MESSAGE_BYTES).toBeGreaterThan(0)
  })
})
