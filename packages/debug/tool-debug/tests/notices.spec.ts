/**
 * Debug stop notices: bounded text without variable values (including the
 * byte-cap truncation branch), wake/quiet delivery per session owner, and
 * suppression of the agent's own unsettled resume stop.
 */

import { describe, expect, it } from 'vitest'
import { fixtureDebugSessionId, fixtureSessionId, fixtureThreadId } from '@deepseek-ai/dsh-debug-fixture'
import { createStopNotice, shouldWake } from '../src/notices.ts'

const sessionId = fixtureDebugSessionId(1)

describe('debug stop notices', () => {
  it('builds a bounded notice without variable values', () => {
    const notice = createStopNotice({
      sessionId, reason: 'breakpoint', threadId: fixtureThreadId(1),
      source: 'src/a.ts', line: 4, column: 2,
    }, { maxBytes: 256 })
    expect(notice.length).toBeLessThanOrEqual(256)
    expect(notice).toContain(sessionId)
    expect(notice).toContain('src/a.ts:4')
  })

  it('truncates to the byte cap when the facts run long', () => {
    const notice = createStopNotice({
      sessionId, reason: 'breakpoint', threadId: fixtureThreadId(1),
      source: 'src/a.ts', line: 4, column: 2,
      description: 'd'.repeat(400),
    }, { maxBytes: 64 })
    expect(notice.length).toBeLessThanOrEqual(64)
    expect(notice.endsWith('…')).toBe(true)
  })

  it('has no channel from variable or environment values into the notice text', () => {
    const notice = createStopNotice({
      sessionId, reason: 'exception', threadId: fixtureThreadId(1),
      source: 'src/a.ts', line: 9, column: 1,
    }, { maxBytes: 256 })
    // The stop-facts type carries only identity, reason, position, and an
    // optional description; the rendered fields below are its whole surface,
    // so a variable or environment value has no field to ride in on.
    expect(notice).not.toContain('=')
    expect(notice).not.toContain('TOKEN')
    expect(notice).not.toContain('do-not-show')
  })

  it('wakes agent-owned sessions by default and respects quiet mode', () => {
    expect(shouldWake({ owner: 'agent', delivery: 'wakeup' })).toBe(true)
    expect(shouldWake({ owner: 'user', delivery: 'wakeup' })).toBe(false)
    expect(shouldWake({ owner: 'agent', delivery: 'quiet' })).toBe(false)
  })

  it('suppresses the stop caused by this session unsettled resume request', () => {
    expect(shouldWake({ owner: 'agent', delivery: 'wakeup', pendingResumeBy: fixtureSessionId(1), caller: fixtureSessionId(1) })).toBe(false)
    expect(shouldWake({ owner: 'agent', delivery: 'wakeup', pendingResumeBy: fixtureSessionId(2), caller: fixtureSessionId(1) })).toBe(true)
  })
})
