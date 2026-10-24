/**
 * The session record the registry owns and the in-process live session the
 * service returns. The record carries the mutable lifecycle the backend
 * drives; the live session is the read-and-teardown face consumers hold.
 * @module @deepseek-ai/dsh-debug/session
 */

import type { DebugProviderId, DebugSessionId } from './brand.ts'
import type { DebugEventActor } from './events.ts'
import type { DebugSessionInfo, DebugSessionState } from './types.ts'
import type { SessionId } from '@deepseek-ai/dsh-session'

/** One registered debug session's lifecycle state and teardown handle. */
export interface DebugSessionRecord {
  readonly id: DebugSessionId
  readonly providerId: DebugProviderId
  readonly workspaceId: string
  readonly ownerSessionId?: SessionId
  /** Current lifecycle state; only the owning backend advances it. */
  state: DebugSessionState
  /** Commit a new state; the registry publishes only after this returns. */
  setState(state: DebugSessionState): void
  /** Tear the session down; called at most once by the registry. */
  dispose(): Promise<void>
}

/** The teardown capability a live session delegates terminal operations to. */
export interface DebugSessionTeardown {
  remove(id: DebugSessionId, actor: DebugEventActor): Promise<void>
}

/** The live-session face of one registered record: identity, state, and terminal teardown. */
export interface DebugLiveSession {
  readonly id: DebugSessionId
  readonly state: DebugSessionState
  readonly info: DebugSessionInfo
  terminate(): Promise<void>
  disconnect(): Promise<void>
}

/**
 * In-process live session over one registry record. Terminal operations are
 * idempotent through the registry's removal settlement; the distinction
 * between `terminate` and `disconnect` lands with the DAP backend that can
 * actually send the two different DAP requests.
 */
export class LiveDebugSession implements DebugLiveSession {
  constructor(
    private readonly record: DebugSessionRecord,
    private readonly teardown: DebugSessionTeardown,
  ) {}

  get id(): DebugSessionId {
    return this.record.id
  }

  get state(): DebugSessionState {
    return this.record.state
  }

  get info(): DebugSessionInfo {
    return debugSessionInfoOf(this.record)
  }

  terminate(): Promise<void> {
    return this.teardown.remove(this.record.id, 'user')
  }

  disconnect(): Promise<void> {
    return this.teardown.remove(this.record.id, 'user')
  }
}

/**
 * Project one record into its read-facing `DebugSessionInfo`.
 * @param record - the registry record to project.
 * @returns the info snapshot; `ownerSessionId` is present only when set.
 */
export function debugSessionInfoOf(record: {
  readonly id: DebugSessionId
  readonly providerId: DebugProviderId
  readonly workspaceId: string
  readonly state: DebugSessionState
  readonly ownerSessionId?: SessionId
}): DebugSessionInfo {
  return {
    id: record.id,
    providerId: record.providerId,
    workspaceId: record.workspaceId,
    state: record.state,
    ...(record.ownerSessionId !== undefined ? { ownerSessionId: record.ownerSessionId } : {}),
  }
}
