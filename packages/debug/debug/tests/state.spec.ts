/**
 * The debug session state machine: the frozen transition table, its typed
 * rejection of invalid combinations, and terminal-outcome mapping.
 */

import { describe, expect, it } from 'vitest'
import { advanceDebugState, debugTerminalOutcome } from '../src/state.ts'

describe('debug state machine', () => {
  it('accepts the launch, stop, continue, and terminate path', () => {
    expect(advanceDebugState('starting', 'launch-succeeded')).toBe('running')
    expect(advanceDebugState('running', 'stopped')).toBe('stopped')
    expect(advanceDebugState('stopped', 'continued')).toBe('running')
    expect(advanceDebugState('running', 'terminated')).toBe('terminated')
  })

  it('rejects operations that are invalid for the state', () => {
    expect(() => advanceDebugState('running', 'continued')).toThrow(expect.objectContaining({ code: 'DEBUG_INVALID_STATE' }))
    expect(() => advanceDebugState('terminated', 'stopped')).toThrow(expect.objectContaining({ code: 'DEBUG_INVALID_STATE' }))
  })

  it('keeps terminate and disconnect idempotent in both terminal states', () => {
    expect(advanceDebugState('terminated', 'terminated')).toBe('terminated')
    expect(advanceDebugState('failed', 'disconnected')).toBe('terminated')
    expect(debugTerminalOutcome('disconnected')).toBe('disconnected')
    expect(() => debugTerminalOutcome('continued')).toThrow(expect.objectContaining({ code: 'DEBUG_INVALID_STATE' }))
  })

  it('restarts from running and stopped back to starting', () => {
    expect(advanceDebugState('running', 'restart')).toBe('starting')
    expect(advanceDebugState('stopped', 'restart')).toBe('starting')
  })
})
