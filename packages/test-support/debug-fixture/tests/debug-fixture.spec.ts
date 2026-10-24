/**
 * The fixture factory's deterministic id format and its fail-loud seed
 * validation.
 */

import { describe, expect, it } from 'vitest'
import { fixtureDebugSessionId } from '../src/index.ts'

describe('debug fixture factories', () => {
  it('derives session ids in the debug-<16 lowercase hex> format from seeds', () => {
    expect(fixtureDebugSessionId(0)).toBe('debug-0000000000000000')
    expect(fixtureDebugSessionId(1)).toBe('debug-0000000000000001')
    expect(fixtureDebugSessionId(0xdeadbeef)).toBe('debug-00000000deadbeef')
    expect(fixtureDebugSessionId(Number.MAX_SAFE_INTEGER)).toBe('debug-001fffffffffffff')
  })

  it('rejects negative and non-safe-integer seeds', () => {
    expect(() => fixtureDebugSessionId(-1)).toThrow(RangeError)
    expect(() => fixtureDebugSessionId(1.5)).toThrow(RangeError)
    expect(() => fixtureDebugSessionId(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError)
  })
})
