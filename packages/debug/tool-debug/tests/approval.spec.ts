/**
 * Debug approvals: fail-closed when the answerer is unavailable, grant on
 * allowed-once, and deny with the distinction between rejection and absence.
 */

import { describe, expect, it, vi } from 'vitest'
import type { DebugApprovalFace } from '../src/approval.ts'
import { grantControl, requestDebugApproval } from '../src/approval.ts'

/** Build one approval face double resolving the given outcome. */
function approvalDouble(outcome: 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'): DebugApprovalFace {
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
    const error = await requestDebugApproval(rejected, {
      kind: 'write_memory', toolName: 'debug_inspect', reason: 'write 4 bytes', agent: {},
    }).catch((failure: unknown) => failure as { code: string; detail: string })
    expect(error.code).toBe('DEBUG_APPROVAL_DENIED')
    expect(error.detail).toContain('rejected')
    expect(error.detail).not.toContain('unavailable')
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
})
