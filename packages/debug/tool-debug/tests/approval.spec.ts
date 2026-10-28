/**
 * Debug approvals: fail-closed when the answerer is unavailable, grant on
 * allowed-once, and deny with the distinction between rejection and absence.
 * Control authorization covers all three grant sources plus the
 * `DEBUG_CONTROL_NOT_GRANTED` denial when a user-owned session has neither
 * the switch nor an offered single approval.
 */

import { describe, expect, it, vi } from 'vitest'
import { DebugError } from '@deepseek-ai/dsh-debug'
import { grantControl, requestDebugApproval } from '../src/approval.ts'

/** Build one approval face double resolving the given outcome. */
function approvalDouble(outcome: 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable') {
  return { request: vi.fn(async () => outcome) }
}

describe('debug approval', () => {
  it('fails closed when the approval answerer is unavailable', async () => {
    const approval = approvalDouble('unavailable')
    await expect(requestDebugApproval(approval, {
      kind: 'launch', toolName: 'debug_session', reason: 'launch node', agent: {},
    })).rejects.toMatchObject({ code: 'DEBUG_APPROVAL_DENIED' })
  })

  it('allows exactly one launch on allowed-once', async () => {
    const approval = approvalDouble('allowed-once')
    await expect(requestDebugApproval(approval, {
      kind: 'launch', toolName: 'debug_session', reason: 'launch node', agent: {},
    })).resolves.toBeUndefined()
  })

  it('distinguishes an active rejection from a missing answerer in the detail', async () => {
    const rejected = approvalDouble('rejected')
    let code = ''
    let detail = ''
    try {
      await requestDebugApproval(rejected, {
        kind: 'write_memory', toolName: 'debug_inspect', reason: 'write 4 bytes', agent: {},
      })
    } catch (failure) {
      if (failure instanceof DebugError) { code = failure.code; detail = failure.detail ?? '' }
      else { code = 'UNKNOWN'; detail = String(failure) }
    }
    expect(code).toBe('DEBUG_APPROVAL_DENIED')
    expect(detail).toContain('rejected')
    expect(detail).not.toContain('unavailable')
  })

  it('grants control to the owning agent without approval and via approval for cross-owner', async () => {
    const approval = approvalDouble('allowed-once')
    await expect(grantControl(approval, {
      owner: 'agent', caller: 'agent', toolName: 'debug_execution', reason: 'continue',
    })).resolves.toMatchObject({ source: 'owned' })
    await expect(grantControl(approval, {
      owner: 'user', caller: 'agent', toolName: 'debug_execution', reason: 'continue',
      sessionGrant: false, agent: {},
    })).resolves.toMatchObject({ source: 'single-approval' })
  })

  it('denies control of a user-owned session when the switch is off and no single approval is offered', async () => {
    const approval = approvalDouble('allowed-once')
    await expect(grantControl(approval, {
      owner: 'user', caller: 'agent', toolName: 'debug_execution', reason: 'continue',
      sessionGrant: false,
    })).rejects.toMatchObject({ code: 'DEBUG_CONTROL_NOT_GRANTED' })
    expect(approval.request).not.toHaveBeenCalled()
  })

  it('grants cross-owner control through the session switch without asking again', async () => {
    const approval = approvalDouble('allowed-once')
    await expect(grantControl(approval, {
      owner: 'user', caller: 'agent', toolName: 'debug_execution', reason: 'continue',
      sessionGrant: true, agent: {},
    })).resolves.toMatchObject({ source: 'session-grant' })
    expect(approval.request).not.toHaveBeenCalled()
  })
})
