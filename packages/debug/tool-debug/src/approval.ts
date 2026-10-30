/**
 * Debug approvals: launch/attach/write-memory approval through
 * `ctx.approval` (fail-closed), and per-session control authorization with
 * its three grant sources. UI-originated launches use the UI's confirmation
 * dialog and never enter this seam.
 * @module @deepseek-ai/dsh-tool-debug/approval
 */

import { DebugError } from '@deepseek-ai/dsh-debug'

/** The approval face this module consumes (the `ctx.approval` service). */
export interface DebugApprovalFace {
  request(input: {
    readonly agent: unknown
    readonly toolName: string
    readonly reason?: string
    readonly signal?: AbortSignal
  }): Promise<'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'>
}

/** The operation kinds that need approval. */
export type DebugApprovalKind = 'launch' | 'attach' | 'write_memory'

/** One approval request. */
export interface DebugApprovalRequest {
  readonly kind: DebugApprovalKind
  readonly toolName: string
  readonly reason: string
  readonly agent: unknown
  readonly signal?: AbortSignal
}

/**
 * Request one debug approval through the approval seam. Fail-closed:
 * `unavailable` (no answerer composed), `rejected` (an active denial), and
 * `cancelled` (an aborted ask) all reject with `DEBUG_APPROVAL_DENIED`; the
 * detail distinguishes an active rejection from a missing answerer.
 * @param approval - the approval service face.
 * @param request - the approval request.
 * @returns void on `allowed-once` (the only grant).
 * @throws {@link DebugError} `DEBUG_APPROVAL_DENIED` on every non-grant outcome.
 */
export async function requestDebugApproval(
  approval: DebugApprovalFace,
  request: DebugApprovalRequest,
): Promise<void> {
  const outcome = await approval.request({
    agent: request.agent,
    toolName: request.toolName,
    reason: request.reason,
    ...(request.signal !== undefined ? { signal: request.signal } : {}),
  })
  if (outcome === 'allowed-once') return
  const detail = outcome === 'rejected'
    ? 'the user actively rejected this debug operation'
    : outcome === 'cancelled'
      ? 'the approval request was cancelled before a decision'
      : 'no approval answerer is composed in this deployment (fail-closed)'
  throw new DebugError(
    `debug ${request.kind} approval ${outcome}`,
    'DEBUG_APPROVAL_DENIED',
    { detail },
  )
}

/** Where a control grant came from. */
export type DebugControlGrantSource = 'owned' | 'session-grant' | 'single-approval'

/** One granted control authorization. */
export interface DebugControlGrant {
  readonly source: DebugControlGrantSource
}

/** Facts governing one control-authorization decision. */
export interface DebugControlFacts {
  /** Who owns the debug session. */
  readonly owner: 'agent' | 'user'
  /** Who is requesting control. */
  readonly caller: 'agent' | 'user'
  readonly toolName: string
  readonly reason: string
  /** Whether the session's "allow agent control" switch is on. */
  readonly sessionGrant?: boolean
  readonly agent?: unknown
  readonly signal?: AbortSignal
}

/**
 * Decide whether the caller may control the debug session, and through which
 * grant source. The caller controlling its own session — agent or user — is
 * granted without approval (`owned`); a session-grant switch authorizes
 * cross-owner control (`session-grant`); otherwise a single-use approval
 * decides (`single-approval`).
 * @param approval - the approval service face.
 * @param facts - owner, caller, session switch, and approval routing.
 * @returns the grant with its source.
 * @throws {@link DebugError} `DEBUG_CONTROL_NOT_GRANTED` when the single
 * approval fails; `DEBUG_APPROVAL_DENIED` when the approval seam fails
 * closed.
 */
export async function grantControl(
  approval: DebugApprovalFace,
  facts: DebugControlFacts,
): Promise<DebugControlGrant> {
  if (facts.owner === facts.caller) {
    return { source: 'owned' }
  }
  if (facts.sessionGrant === true) {
    return { source: 'session-grant' }
  }
  if (facts.caller === 'agent' && facts.agent !== undefined) {
    await requestDebugApproval(approval, {
      kind: 'launch',
      toolName: facts.toolName,
      reason: `agent control of a user-owned debug session: ${facts.reason}`,
      agent: facts.agent,
      ...(facts.signal !== undefined ? { signal: facts.signal } : {}),
    })
    return { source: 'single-approval' }
  }
  throw new DebugError(
    'the caller has no control grant for this debug session',
    'DEBUG_CONTROL_NOT_GRANTED',
    { detail: 'the session is user-owned, the session-grant switch is off, and no single approval was requested' },
  )
}
