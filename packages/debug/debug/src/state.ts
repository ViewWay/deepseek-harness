/**
 * The debug session state machine: the frozen seven-event transition table
 * (no `adapter-ready` — the adapter process running already means
 * `starting`) and the terminal-outcome mapping durable `debug/session-ended`
 * events record.
 * @module @deepseek-ai/dsh-debug/state
 */

import type { DebugSessionState } from './types.ts'
import { DebugError } from './error.ts'

/** State-machine events; each names the debug fact that occurred, not the operation a caller issued. */
export type DebugStateEvent =
  | 'launch-succeeded' | 'stopped' | 'continued' | 'restart'
  | 'terminated' | 'disconnected' | 'failed'

/** How a session ended; `terminated` and `disconnected` stay distinct so `debug/session-ended` records which side closed. */
export type DebugSessionOutcome = 'terminated' | 'disconnected' | 'failed'

/**
 * Every legal `(state, event) → state` edge. `terminated`/`failed` accept
 * only `terminated`/`disconnected` — repeated `terminate()`/`disconnect()`
 * is idempotent and returns the current state instead of throwing.
 */
const TRANSITIONS: Record<DebugSessionState, Partial<Record<DebugStateEvent, DebugSessionState>>> = {
  starting: {
    'launch-succeeded': 'running', stopped: 'stopped', restart: 'starting',
    terminated: 'terminated', disconnected: 'terminated', failed: 'failed',
  },
  running: {
    stopped: 'stopped', restart: 'starting',
    terminated: 'terminated', disconnected: 'terminated', failed: 'failed',
  },
  stopped: {
    continued: 'running', stopped: 'stopped', restart: 'starting',
    terminated: 'terminated', disconnected: 'terminated', failed: 'failed',
  },
  terminated: { terminated: 'terminated', disconnected: 'terminated' },
  failed: { terminated: 'terminated', disconnected: 'terminated' },
}

/**
 * Advance one session state over a state event.
 * @param state - the session's current state.
 * @param event - the state event that occurred.
 * @returns the next state (terminal states absorb repeated termination).
 * @throws {@link DebugError} `DEBUG_INVALID_STATE` for any `(state, event)` pair the table does not list.
 */
export function advanceDebugState(state: DebugSessionState, event: DebugStateEvent): DebugSessionState {
  const next = TRANSITIONS[state][event]
  if (next === undefined) throw new DebugError(`invalid debug transition ${state} -> ${event}`, 'DEBUG_INVALID_STATE')
  return next
}

/**
 * Map one terminal state event to the outcome `debug/session-ended` records.
 * @param event - a terminal state event.
 * @returns the matching outcome.
 * @throws {@link DebugError} `DEBUG_INVALID_STATE` when the event is not terminal.
 */
export function debugTerminalOutcome(event: DebugStateEvent): DebugSessionOutcome {
  switch (event) {
    case 'terminated':
    case 'disconnected':
    case 'failed':
      return event
    default:
      throw new DebugError(`non-terminal event has no outcome: ${event}`, 'DEBUG_INVALID_STATE')
  }
}
