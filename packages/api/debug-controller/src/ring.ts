/**
 * The controller's per-session event log: one monotonic `debugEventSeq`
 * cursor per session over a bounded replay ring.
 *
 * Each session's events are numbered from 1; `replay` returns everything
 * after the caller's cursor while it still fits in the ring. A cursor behind
 * the ring's retention reports `expired`, which the controller surfaces as
 * the `debug/event-cursor-expired` flow-control code so clients resynchronize
 * instead of silently missing events.
 * @module @deepseek-ai/dsh-api-debug-controller/ring
 */

import type { JsonValue } from '@deepseek-ai/dsh-debug/types'

/** One sequenced debug event retained for replay. */
export interface DebugEventRecord {
  /** Monotonic per-session `debugEventSeq`; a session's first event is 1. */
  readonly seq: number
  /** Session the event belongs to. */
  readonly sessionId: string
  /** Event payload as durable/wire-safe JSON. */
  readonly payload: JsonValue
}

/** Outcome of one replay request. */
export interface DebugEventReplay {
  /** Retained events after the caller's cursor, in sequence order. */
  readonly records: readonly DebugEventRecord[]
  /** True when the cursor fell behind the ring's retention. */
  readonly expired: boolean
  /** The session's newest sequence; clients persist it as their cursor. */
  readonly latestSeq: number
}

/** Bounded event ring with one monotonic sequence per session. */
export class DebugEventRing {
  private readonly limit: number
  private readonly records: DebugEventRecord[] = []
  private readonly nextSeqBySession = new Map<string, number>()

  /**
   * @param limit - Retention capacity; the oldest records are dropped once
   *   the ring fills.
   */
  constructor(limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new RangeError('debug event ring limit must be a positive safe integer')
    }
    this.limit = limit
  }

  /**
   * Appends one event and assigns its per-session sequence.
   *
   * @param sessionId - Session the event belongs to.
   * @param payload - Event payload.
   * @returns The assigned `debugEventSeq`.
   */
  append(sessionId: string, payload: JsonValue): number {
    const next = (this.nextSeqBySession.get(sessionId) ?? 0) + 1
    this.nextSeqBySession.set(sessionId, next)
    this.records.push({ seq: next, sessionId, payload })
    if (this.records.length > this.limit) this.records.shift()
    return next
  }

  /**
   * Replays one session's events after a cursor.
   *
   * @param sessionId - Session whose events to replay.
   * @param after - The caller's last seen sequence; 0 replays from the start.
   * @returns The retained slice, expiry flag, and the session's newest
   *   sequence (the cursor itself when the session has no retained events).
   */
  /**
   * All retained records in append order; test-facing read of the ring.
   * @returns Every retained record, oldest first.
   */
  replayAll(): readonly DebugEventRecord[] {
    return [...this.records]
  }

  /**
   * Replay one session's retained events after a cursor.
   * @param sessionId - Session whose events to replay.
   * @param after - The caller's last seen sequence; 0 replays from the start.
   * @returns The retained slice, expiry flag, and the session's newest sequence.
   */
  replay(sessionId: string, after: number): DebugEventReplay {
    const scoped = this.records.filter(record => record.sessionId === sessionId)
    if (scoped.length === 0) {
      return { records: [], expired: false, latestSeq: after }
    }
    const oldest = scoped[0]?.seq ?? 0
    const latestSeq = scoped[scoped.length - 1]?.seq ?? after
    return {
      records: scoped.filter(record => record.seq > after),
      expired: after < oldest - 1,
      latestSeq,
    }
  }
}
