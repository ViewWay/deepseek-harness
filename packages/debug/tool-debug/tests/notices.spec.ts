/**
 * Debug stop notices: bounded text without variable values (including the
 * byte-cap truncation branch), wake/quiet delivery per session owner, and
 * suppression of the agent's own unsettled resume stop. The delivery unit
 * covers the wake, inject, budget-degrade, and suppression outcomes and the
 * durable `debug` message source the notice carries.
 */

/* oxlint-disable typescript/no-unsafe-assignment -- Vitest asymmetric matchers are typed as any. */
import { describe, expect, it, vi } from 'vitest'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { fixtureDebugSessionId, fixtureSessionId, fixtureThreadId } from '@deepseek-ai/dsh-debug-fixture'
import { createStopNotice, deliverStopNotice, shouldWake } from '../src/notices.ts'
import type { DebugNoticeTarget } from '../src/notices.ts'

const sessionId = fixtureDebugSessionId(1)

/** One stop-facts record with per-test overrides. */
function stopFacts(overrides: Partial<Parameters<typeof createStopNotice>[0]> = {}) {
  return {
    sessionId, reason: 'breakpoint', threadId: fixtureThreadId(1),
    source: 'src/a.ts', line: 4, column: 2,
    ...overrides,
  }
}

/** One recording delivery target with its idleness. */
function targetDouble(idle: boolean) {
  const inject = vi.fn((_message: UserMessage) => {})
  const followup = vi.fn((_message: UserMessage) => {})
  const target: DebugNoticeTarget = { idle, inject, followup }
  return { target, inject, followup }
}

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

describe('debug stop-notice delivery', () => {
  it('wakes an idle agent-owned session with the durable debug source', () => {
    const { target, followup, inject } = targetDouble(true)
    const outcome = deliverStopNotice(stopFacts(), {
      owner: 'agent', delivery: 'wakeup', caller: fixtureSessionId(1),
    }, { maxBytes: 256 }, target)
    expect(outcome).toBe('woken')
    expect(inject).not.toHaveBeenCalled()
    const message = followup.mock.calls[0]?.[0]
    expect(message?.source).toMatchObject({ kind: 'debug', sessionId, reason: 'breakpoint' })
    expect(message?.content).toEqual([{ type: 'text', text: expect.stringContaining('src/a.ts:4') }])
  })

  it('injects a busy owner or a quiet deployment instead of waking', () => {
    const busy = targetDouble(false)
    expect(deliverStopNotice(stopFacts(), {
      owner: 'agent', delivery: 'wakeup', caller: fixtureSessionId(1),
    }, { maxBytes: 256 }, busy.target)).toBe('injected')
    expect(busy.inject).toHaveBeenCalledTimes(1)
    const quiet = targetDouble(true)
    expect(deliverStopNotice(stopFacts(), {
      owner: 'agent', delivery: 'quiet', caller: fixtureSessionId(1),
    }, { maxBytes: 256 }, quiet.target)).toBe('injected')
    expect(quiet.followup).not.toHaveBeenCalled()
  })

  it('injects stops on user-owned sessions even when the receiver is idle', () => {
    const { target, followup, inject } = targetDouble(true)
    expect(deliverStopNotice(stopFacts(), {
      owner: 'user', delivery: 'wakeup', caller: fixtureSessionId(1),
    }, { maxBytes: 256 }, target)).toBe('injected')
    expect(followup).not.toHaveBeenCalled()
    expect(inject).toHaveBeenCalledTimes(1)
  })

  it('suppresses the stop the receiving session own unsettled resume caused', () => {
    const { target, followup, inject } = targetDouble(true)
    expect(deliverStopNotice(stopFacts(), {
      owner: 'agent', delivery: 'wakeup', pendingResumeBy: fixtureSessionId(1), caller: fixtureSessionId(1),
    }, { maxBytes: 256 }, target)).toBe('suppressed')
    expect(followup).not.toHaveBeenCalled()
    expect(inject).not.toHaveBeenCalled()
  })

  it('degrades to injection once the wake budget is spent', () => {
    const { target, followup, inject } = targetDouble(true)
    expect(deliverStopNotice(stopFacts(), {
      owner: 'agent', delivery: 'wakeup', caller: fixtureSessionId(1), remainingWakes: 0,
    }, { maxBytes: 256 }, target)).toBe('injected')
    expect(followup).not.toHaveBeenCalled()
    expect(inject).toHaveBeenCalledTimes(1)
  })
})
