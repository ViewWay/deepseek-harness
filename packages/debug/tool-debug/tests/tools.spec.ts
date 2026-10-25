/**
 * The debug tool vocabulary: exactly four tools, closed operation unions, and
 * typed rejection of unknown operations.
 */

import { describe, expect, it } from 'vitest'
import { DEBUG_TOOL_NAMES, parseDebugOperation } from '../src/tools.ts'

describe('debug tool vocabulary', () => {
  it('registers exactly four tools', () => {
    expect(DEBUG_TOOL_NAMES).toEqual(['debug_session', 'debug_execution', 'debug_inspect', 'debug_breakpoints'])
  })

  it('rejects an unknown operation instead of falling through', () => {
    expect(() => parseDebugOperation('debug_execution', 'explode'))
      .toThrow(expect.objectContaining({ code: 'DEBUG_UNKNOWN_OPERATION' }))
    expect(() => parseDebugOperation('debug_session', 'launchh'))
      .toThrow(expect.objectContaining({ code: 'DEBUG_UNKNOWN_OPERATION' }))
  })

  it('accepts every documented operation', () => {
    expect(parseDebugOperation('debug_session', 'launch')).toBe('launch')
    expect(parseDebugOperation('debug_session', 'attach_targets')).toBe('attach_targets')
    expect(parseDebugOperation('debug_execution', 'step_over')).toBe('step_over')
    expect(parseDebugOperation('debug_execution', 'wait_for_stop')).toBe('wait_for_stop')
    expect(parseDebugOperation('debug_inspect', 'variables')).toBe('variables')
    expect(parseDebugOperation('debug_inspect', 'write_memory')).toBe('write_memory')
    expect(parseDebugOperation('debug_breakpoints', 'set_file')).toBe('set_file')
    expect(parseDebugOperation('debug_breakpoints', 'clear')).toBe('clear')
  })
})
