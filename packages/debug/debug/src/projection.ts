/**
 * The `debugSessions` session projection: folds the durable `debug/*`
 * events into one bounded session list for reconnection and session lists.
 * The fold is synchronous, deterministic, and side-effect free; checkpoint
 * plus suffix replay equals full replay. The projection never enters the
 * system prompt — models query through tools.
 * @module @deepseek-ai/dsh-debug/projection
 */

import { z as zod } from 'zod'
import type { ZodType } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import type { SessionLogOffset } from '@deepseek-ai/dsh-session'
import type { DebugSessionState } from './types.ts'

/** One projected stop: the durable `debug/stopped` fields a reconnection needs. */
export interface DebugProjectedStop {
  readonly reason: DebugStoppedReason
  readonly source: string
  readonly line: number
  readonly column: number
  readonly threadId: string
  readonly description?: string
}

/** Reasons a projected stop can carry; mirrors the durable event's closed set. */
export type DebugStoppedReason =
  | 'breakpoint' | 'step' | 'pause' | 'entry' | 'exception'
  | 'dataBreakpoint' | 'instructionBreakpoint' | 'restart' | 'unknown'

/** One projected debug session: identity, lifecycle state, and bounded stop history. */
export interface DebugProjectedSession {
  readonly id: string
  readonly providerId: string
  readonly mode: 'launch' | 'attach'
  readonly state: DebugSessionState
  readonly stops: readonly DebugProjectedStop[]
  readonly lastStop?: DebugProjectedStop
}

/** Projection state: the newest sessions, each with its bounded stops. */
export interface DebugSessionsProjectionState {
  readonly sessions: readonly DebugProjectedSession[]
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /**
     * Debug session lifecycle view rebuilt from `debug/*` events: newest
     * sessions with their current state and last stop.
     */
    debugSessions: DebugSessionsProjectionState
  }
}

const projectedStopSchema = zod.object({
  reason: zod.enum([
    'breakpoint', 'step', 'pause', 'entry', 'exception',
    'dataBreakpoint', 'instructionBreakpoint', 'restart', 'unknown',
  ]),
  source: zod.string(),
  line: zod.number().int(),
  column: zod.number().int(),
  threadId: zod.string(),
  description: zod.string().optional(),
}) as ZodType<DebugProjectedStop>

const projectedSessionSchema = zod.object({
  id: zod.string(),
  providerId: zod.string(),
  mode: zod.enum(['launch', 'attach']),
  state: zod.enum(['starting', 'running', 'stopped', 'terminated', 'failed']),
  stops: zod.array(projectedStopSchema),
  lastStop: projectedStopSchema.optional(),
}) as ZodType<DebugProjectedSession>

const debugSessionsStateSchema = zod.object({
  sessions: zod.array(projectedSessionSchema),
}) as ZodType<DebugSessionsProjectionState>

/** Deployment bounds for the projection; both are Config fields on `ctx.debug`. */
export interface DebugSessionsProjectionConfig {
  /** Newest sessions retained; older ones drop from the view first. */
  readonly maxProjectedSessions: number
  /** Stops retained per session; the newest survive. */
  readonly maxProjectedStops: number
}

/** Default session retention bound matching the `Debug` plugin's Config default. */
export const DEFAULT_MAX_PROJECTED_SESSIONS = 32

/** Default per-session stop retention bound matching the `Debug` plugin's Config default. */
export const DEFAULT_MAX_PROJECTED_STOPS = 20

/** Map a durable ended outcome onto the five-state lifecycle vocabulary. */
function endedState(outcome: 'terminated' | 'disconnected' | 'failed'): DebugSessionState {
  switch (outcome) {
    case 'failed': return 'failed'
    case 'terminated': return 'terminated'
    case 'disconnected': return 'terminated'
  }
}

/** The `debugSessions` projection unit: the definition contract with `wire` required. */
export type DebugSessionsProjectionDefinition =
  Omit<ProjectionDefinition<'debugSessions', DebugSessionsProjectionState>, 'wire'> & {
    wire: {
      viewSchema: ZodType<DebugSessionsProjectionState>
      view: (state: DebugSessionsProjectionState) => DebugSessionsProjectionState
    }
  }

/**
 * Create the `debugSessions` projection with explicit retention bounds.
 * @param config - session and per-session stop retention bounds.
 * @returns the projection definition to register on `ctx.sessionProjections`.
 */
export function createDebugSessionsProjection(config: DebugSessionsProjectionConfig): DebugSessionsProjectionDefinition {
  return {
    key: 'debugSessions',
    stateVersion: 1,
    stateSchema: debugSessionsStateSchema,
    init: (_header: SessionHeader, _inheritedEventCount: SessionLogOffset): DebugSessionsProjectionState => ({ sessions: [] }),
    apply: (state: DebugSessionsProjectionState, event: SessionEvent): DebugSessionsProjectionState => {
      switch (event.type) {
        case 'debug/session-started': {
          const session: DebugProjectedSession = {
            id: event.data.sessionId,
            providerId: event.data.providerId,
            mode: event.data.mode,
            state: 'starting',
            stops: [],
          }
          const sessions = state.sessions.filter(existing => existing.id !== session.id)
          sessions.push(session)
          return { sessions: sessions.slice(-config.maxProjectedSessions) }
        }
        case 'debug/stopped': {
          const index = state.sessions.findIndex(existing => existing.id === event.data.sessionId)
          const session = state.sessions[index]
          if (session === undefined) return state
          const stop: DebugProjectedStop = {
            reason: event.data.reason,
            source: event.data.source,
            line: event.data.line,
            column: event.data.column,
            threadId: event.data.threadId,
            ...(event.data.description !== undefined ? { description: event.data.description } : {}),
          }
          const updated: DebugProjectedSession = {
            ...session,
            state: 'stopped',
            stops: [...session.stops, stop].slice(-config.maxProjectedStops),
            lastStop: stop,
          }
          const sessions = [...state.sessions]
          sessions[index] = updated
          return { sessions }
        }
        case 'debug/session-ended': {
          const index = state.sessions.findIndex(existing => existing.id === event.data.sessionId)
          const session = state.sessions[index]
          if (session === undefined) return state
          const updated: DebugProjectedSession = { ...session, state: endedState(event.data.outcome) }
          const sessions = [...state.sessions]
          sessions[index] = updated
          return { sessions }
        }
        default:
          return state
      }
    },
    wire: { viewSchema: debugSessionsStateSchema, view: state => state },
  }
}

/** The `debugSessions` projection with the plugin's default retention bounds. */
export const debugSessionsProjection = createDebugSessionsProjection({
  maxProjectedSessions: DEFAULT_MAX_PROJECTED_SESSIONS,
  maxProjectedStops: DEFAULT_MAX_PROJECTED_STOPS,
})
