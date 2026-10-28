/**
 * The fixture factory's deterministic id format and its fail-loud seed
 * validation.
 */

import { describe, expect, it } from 'vitest'
import { DebugProviderId } from '@deepseek-ai/dsh-debug'
import { fixtureDebugBreakpointId, fixtureDebugEnvironment, fixtureDebugSessionId } from '../src/index.ts'

describe('debug fixture factories', () => {
  it('derives session ids in the debug-<16 lowercase hex> format from seeds', () => {
    expect(fixtureDebugSessionId(0)).toBe('debug-0000000000000000')
    expect(fixtureDebugSessionId(1)).toBe('debug-0000000000000001')
    expect(fixtureDebugSessionId(0xdeadbeef)).toBe('debug-00000000deadbeef')
    expect(fixtureDebugSessionId(Number.MAX_SAFE_INTEGER)).toBe('debug-001fffffffffffff')
  })

  it('derives breakpoint ids in the bp-<16 lowercase hex> format from seeds', () => {
    expect(fixtureDebugBreakpointId(1)).toBe('bp-0000000000000001')
    expect(() => fixtureDebugBreakpointId(-1)).toThrow(RangeError)
  })

  it('rejects negative and non-safe-integer seeds', () => {
    expect(() => fixtureDebugSessionId(-1)).toThrow(RangeError)
    expect(() => fixtureDebugSessionId(1.5)).toThrow(RangeError)
    expect(() => fixtureDebugSessionId(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError)
  })

  it('builds a typed environment double whose adapter resolver returns the default adapter', async () => {
    const environment = fixtureDebugEnvironment()
    expect(environment.workspaceRoot).toBe('/ws')
    expect(environment.platform).toBe('linux')
    expect(environment.pathSeparator).toBe('/')
    await expect(environment.adapters.resolve(DebugProviderId('node'))).resolves.toMatchObject({
      command: ['node', 'js-debug/src/dapDebugServer.js'],
      version: '1.140.0',
      source: 'managed',
    })
    expect(environment.adapters.resolve).toHaveBeenCalledOnce()
  })
})
