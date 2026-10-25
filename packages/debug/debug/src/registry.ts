/**
 * The debug session registry: insertion-ordered, workspace-scoped session
 * records with commit-then-publish state changes and idempotent teardown.
 * @module @deepseek-ai/dsh-debug/registry
 */

import type { DebugSessionId } from './brand.ts'
import { DebugError } from './error.ts'
import type { DebugSessionState } from './types.ts'
import { DebugEventBus } from './events.ts'
import type { DebugEvent, DebugEventActor, DebugEventSource } from './events.ts'
import type { DebugSessionRecord } from './session.ts'
import type { SessionId } from '@deepseek-ai/dsh-session'

/** Narrowing scope for registry reads; an unset member does not filter. */
export interface DebugSessionScope {
  readonly workspaceId?: string
  readonly ownerSessionId?: SessionId
}

/** The live event one state publishes; terminal states publish through removal, not setState. */
function stateEvent(
  state: DebugSessionState,
  sessionId: DebugSessionId,
  workspaceId: string,
): DebugEvent | undefined {
  switch (state) {
    case 'starting': return { kind: 'session/starting', sessionId, workspaceId }
    case 'running': return { kind: 'session/running', sessionId, workspaceId }
    case 'stopped': return { kind: 'session/stopped', sessionId, workspaceId }
    case 'failed': return { kind: 'session/failed', sessionId, workspaceId }
    case 'terminated': return undefined
  }
}

/**
 * The session registry behind `ctx.debug`. Owns record identity, live
 * publication, and teardown settlement: `remove` awaits the record's
 * `dispose` exactly once, publishes `session/terminated` after it settles,
 * and stays idempotent for concurrent and later calls.
 */
export class DebugSessionRegistry {
  private readonly bus = new DebugEventBus()
  private readonly records = new Map<DebugSessionId, DebugSessionRecord>()
  /** In-flight removals so repeated `remove` calls share one settlement. */
  private readonly removals = new Map<DebugSessionId, Promise<void>>()

  /** Live event source over this registry's sessions. */
  get events(): DebugEventSource {
    return this.bus
  }

  /**
   * Publish one committed debug fact onto the live event source; owners of
   * non-session events (for example `breakpoint/changed`) route through here.
   * @param event - the committed fact to publish.
   */
  publish(event: DebugEvent): void {
    this.bus.publish(event)
  }

  /**
   * Register one session record; publishes `session/starting` after the insert commits.
   * @param record - the record to register.
   * @throws {@link DebugError} `DEBUG_CONFLICT` when the id is already registered.
   */
  add(record: DebugSessionRecord): void {
    if (this.records.has(record.id)) {
      throw new DebugError(`a debug session with id "${record.id}" is already registered`, 'DEBUG_CONFLICT', { sessionId: record.id })
    }
    this.records.set(record.id, record)
    this.bus.publish({ kind: 'session/starting', sessionId: record.id, workspaceId: record.workspaceId })
  }

  /**
   * Read one record, enforcing the workspace boundary.
   * @param id - the session's id.
   * @param scope - optional workspace scope; a mismatching workspace is rejected.
   * @returns the record, or undefined when the id is not registered.
   * @throws {@link DebugError} `DEBUG_WORKSPACE_MISMATCH` when the scope's workspace differs.
   */
  get(id: DebugSessionId, scope?: DebugSessionScope): DebugSessionRecord | undefined {
    const record = this.records.get(id)
    if (record === undefined) return undefined
    if (scope?.workspaceId !== undefined && scope.workspaceId !== record.workspaceId) {
      throw new DebugError(
        `debug session "${id}" belongs to workspace "${record.workspaceId}", not "${scope.workspaceId}"`,
        'DEBUG_WORKSPACE_MISMATCH',
        { sessionId: id, workspaceId: scope.workspaceId },
      )
    }
    return record
  }

  /**
   * List records in insertion order, narrowed by the scope's set members.
   * @param scope - optional workspace and owner narrowing.
   * @returns the matching records in registration order.
   */
  list(scope?: DebugSessionScope): readonly DebugSessionRecord[] {
    return [...this.records.values()].filter(record =>
      (scope?.workspaceId === undefined || scope.workspaceId === record.workspaceId)
      && (scope?.ownerSessionId === undefined || scope.ownerSessionId === record.ownerSessionId),
    )
  }

  /**
   * Commit one state change, then publish its live event.
   * @param id - the session's id.
   * @param state - the new state.
   */
  setState(id: DebugSessionId, state: DebugSessionState): void {
    const record = this.records.get(id)
    // A late commit after removal needs no publication: removal already
    // published the terminal event for this session.
    if (record === undefined) return
    record.setState(state)
    const event = stateEvent(state, record.id, record.workspaceId)
    if (event !== undefined) {
      this.bus.publish(event)
    }
  }

  /**
   * Tear one session down exactly once, then publish `session/terminated`.
   * @param id - the session's id.
   * @param actor - which side triggered the teardown.
   * @returns a promise that settles when the session is disposed, unpublished
   * work is done, and the id is released; repeated calls share the settlement.
   */
  remove(id: DebugSessionId, actor: DebugEventActor): Promise<void> {
    const inFlight = this.removals.get(id)
    if (inFlight !== undefined) return inFlight
    const record = this.records.get(id)
    if (record === undefined) return Promise.resolve()
    const removal = (async () => {
      await record.dispose()
      this.records.delete(id)
      this.removals.delete(id)
      this.bus.publish({ kind: 'session/terminated', sessionId: id, workspaceId: record.workspaceId, actor })
    })()
    this.removals.set(id, removal)
    return removal
  }
}
