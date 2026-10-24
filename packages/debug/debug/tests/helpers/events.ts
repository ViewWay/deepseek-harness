/**
 * Typed constructors for `debug/*` session events and one unrelated event,
 * returning narrow `SessionEvent` values so projection specs never cast.
 */

import type { DebugSessionId, DebugThreadId } from '@deepseek-ai/dsh-debug'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** Deterministic seq counter shared by the constructors; tests fold in order. */
let nextSeq = 0

/** Allocate the next deterministic branded event seq. */
function seq(): SessionSeq {
  const current = SessionSeq(nextSeq)
  nextSeq += 1
  return current
}

/** Initialization subset for a `debug/session-started` event. */
export interface SessionStartedEventInit {
  readonly sessionId: DebugSessionId
  readonly providerId?: string
  readonly mode?: 'launch' | 'attach'
  readonly workspaceRoot?: string
  readonly adapterVersion?: string
}

/**
 * Build one durable `debug/session-started` event with the ignorable envelope.
 * @param init - branded session id plus optional defaults for the rest.
 * @returns the narrow session event, ready to fold.
 */
export function sessionStartedEvent(init: SessionStartedEventInit): SessionEvent<'debug/session-started'> {
  const providerId = init.providerId ?? 'node'
  return {
    type: 'debug/session-started',
    seq: seq(),
    time: 0,
    ignorable: true,
    data: {
      sessionId: init.sessionId,
      providerId,
      language: providerId,
      mode: init.mode ?? 'launch',
      workspaceRoot: init.workspaceRoot ?? '/ws',
      adapterVersion: init.adapterVersion ?? '1.0.0',
    },
  }
}

/** Initialization subset for a `debug/stopped` event. */
export interface StoppedEventInit {
  readonly sessionId: DebugSessionId
  readonly reason?: 'breakpoint' | 'step' | 'pause' | 'entry' | 'exception' | 'dataBreakpoint' | 'instructionBreakpoint' | 'restart' | 'unknown'
  readonly threadId?: DebugThreadId
  readonly source?: string
  readonly line?: number
  readonly column?: number
  readonly description?: string
}

/**
 * Build one durable `debug/stopped` event with the ignorable envelope.
 * @param init - branded ids plus optional defaults for the rest.
 * @returns the narrow session event, ready to fold.
 */
export function stoppedEvent(init: StoppedEventInit): SessionEvent<'debug/stopped'> {
  return {
    type: 'debug/stopped',
    seq: seq(),
    time: 0,
    ignorable: true,
    data: {
      sessionId: init.sessionId,
      reason: init.reason ?? 'breakpoint',
      threadId: init.threadId ?? 'thread-1',
      source: init.source ?? 'src/a.ts',
      line: init.line ?? 1,
      column: init.column ?? 1,
      ...(init.description !== undefined ? { description: init.description } : {}),
    },
  }
}

/** Initialization subset for a `debug/session-ended` event. */
export interface SessionEndedEventInit {
  readonly sessionId: DebugSessionId
  readonly outcome?: 'terminated' | 'disconnected' | 'failed'
  readonly reason?: string
  readonly durationMs?: number
}

/**
 * Build one durable `debug/session-ended` event with the ignorable envelope.
 * @param init - branded session id plus optional defaults for the rest.
 * @returns the narrow session event, ready to fold.
 */
export function sessionEndedEvent(init: SessionEndedEventInit): SessionEvent<'debug/session-ended'> {
  return {
    type: 'debug/session-ended',
    seq: seq(),
    time: 0,
    ignorable: true,
    data: {
      sessionId: init.sessionId,
      outcome: init.outcome ?? 'terminated',
      reason: init.reason ?? 'completed',
      durationMs: init.durationMs ?? 0,
    },
  }
}

/**
 * Build one durable `debug/control` audit event with the ignorable envelope.
 * @param sessionId - branded session id the control targeted.
 * @returns the narrow session event, ready to fold.
 */
export function controlEvent(sessionId: DebugSessionId): SessionEvent<'debug/control'> {
  return {
    type: 'debug/control',
    seq: seq(),
    time: 0,
    ignorable: true,
    data: { sessionId, actor: 'user', operation: 'continue', threadId: 'thread-1' },
  }
}

/**
 * Build one unrelated log-only event outside the debug vocabulary.
 * @returns a `turn/start` event the projection must return unchanged.
 */
export function unrelatedSessionEvent(): SessionEvent<'turn/start'> {
  return { type: 'turn/start', seq: seq(), time: 0, data: { turn: 1 } }
}
