/**
 * Debug stop notices: bounded text without variable values, wake/quiet
 * delivery per session owner, and suppression of the agent's own unsettled
 * resume stop.
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
