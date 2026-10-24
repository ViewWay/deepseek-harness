/**
 * Typed factories for `DebugSessionRecord` doubles in this package's specs.
 */

import { vi } from 'vitest'
import type { Mock } from 'vitest'
import { DebugProviderId } from '@deepseek-ai/dsh-debug'
import type { DebugSessionId, DebugSessionRecord, DebugSessionState } from '@deepseek-ai/dsh-debug'
import type { SessionId } from '@deepseek-ai/dsh-session'

/** Initialization subset for one session-record double. */
export interface SessionRecordInit {
  readonly id: DebugSessionId
  readonly workspaceId: string
  readonly ownerSessionId?: SessionId
  readonly state?: DebugSessionState
}

/** One record double: the record contract plus observable mock lifecycle operations. */
export type SessionRecordDouble = DebugSessionRecord & {
  setState: Mock<(state: DebugSessionState) => void>
  dispose: Mock<() => Promise<void>>
}

/**
 * Build one session-record double with observable `setState`/`dispose`.
 * `setState` writes through to the record's `state` so commits stay visible;
 * both doubles are typed `Mock` so specs assert on them without unbound-method
 * member reads.
 * @param init - identity and initial state of the record.
 * @returns the record double.
 */
export function sessionRecord(init: SessionRecordInit): SessionRecordDouble {
  const record: SessionRecordDouble = {
    id: init.id,
    providerId: DebugProviderId('node'),
    workspaceId: init.workspaceId,
    ...(init.ownerSessionId !== undefined ? { ownerSessionId: init.ownerSessionId } : {}),
    state: init.state ?? 'starting',
    setState: vi.fn((next: DebugSessionState) => {
      record.state = next
    }),
    dispose: vi.fn(async () => {}),
  }
  return record
}
