/**
 * The `debugSessions` projection: folding durable `debug/*` events into one
 * bounded session list, stability on unrelated events, configured caps, and
 * service registration on the projection registry.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionLogOffset } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import Debug from '@deepseek-ai/dsh-debug'
import { fixtureDebugSessionId, fixtureSessionHeader, fixtureThreadId } from '@deepseek-ai/dsh-debug-fixture'
import { debugSessionsProjection, createDebugSessionsProjection } from '../src/projection.ts'
import {
  controlEvent,
  sessionEndedEvent,
  sessionStartedEvent,
  stoppedEvent,
  unrelatedSessionEvent,
} from './helpers/events.ts'

const header = fixtureSessionHeader('session-1')
const offset = SessionLogOffset(0)
const id = fixtureDebugSessionId(1)

describe('debugSessions projection', () => {
  it('folds start, stop, and end into one bounded session record', () => {
    let state = debugSessionsProjection.init(header, offset)
    state = debugSessionsProjection.apply(state, sessionStartedEvent({
      sessionId: id, providerId: 'node', mode: 'launch', workspaceRoot: '/ws', adapterVersion: '1.0.0',
    }))
    state = debugSessionsProjection.apply(state, stoppedEvent({
      sessionId: id, reason: 'breakpoint', threadId: fixtureThreadId(1), source: 'src/a.ts', line: 4, column: 2,
    }))
    expect(state.sessions[0]).toMatchObject({ id, state: 'stopped', lastStop: { line: 4 } })
    state = debugSessionsProjection.apply(state, sessionEndedEvent({ sessionId: id, outcome: 'terminated' }))
    expect(state.sessions[0]).toMatchObject({ state: 'terminated' })
  })

  it('returns the same reference for unrelated and audit-only events', () => {
    const initial = debugSessionsProjection.init(header, offset)
    const started = debugSessionsProjection.apply(initial, sessionStartedEvent({ sessionId: id }))
    expect(debugSessionsProjection.apply(started, unrelatedSessionEvent())).toBe(started)
    expect(debugSessionsProjection.apply(started, controlEvent(id))).toBe(started)
    expect(debugSessionsProjection.apply(started, stoppedEvent({ sessionId: fixtureDebugSessionId(99) }))).toBe(started)
  })

  it('caps retained sessions at the configured bound', () => {
    let state = debugSessionsProjection.init(header, offset)
    for (let index = 0; index < 40; index += 1) {
      state = debugSessionsProjection.apply(state, sessionStartedEvent({ sessionId: fixtureDebugSessionId(index) }))
    }
    expect(state.sessions).toHaveLength(32)
    expect(state.sessions.at(-1)?.id).toBe(fixtureDebugSessionId(39))
  })

  it('honors configured session and stop bounds and maps outcomes to states', () => {
    const projection = createDebugSessionsProjection({ maxProjectedSessions: 2, maxProjectedStops: 1 })
    let state = projection.init(header, offset)
    for (const seed of [1, 2, 3]) {
      state = projection.apply(state, sessionStartedEvent({ sessionId: fixtureDebugSessionId(seed) }))
    }
    expect(state.sessions.map(session => session.id)).toEqual([fixtureDebugSessionId(2), fixtureDebugSessionId(3)])
    const second = fixtureDebugSessionId(2)
    state = projection.apply(state, stoppedEvent({ sessionId: second, line: 10 }))
    state = projection.apply(state, stoppedEvent({ sessionId: second, line: 20 }))
    expect(state.sessions[0]?.stops).toHaveLength(1)
    expect(state.sessions[0]?.lastStop).toMatchObject({ line: 20 })
    state = projection.apply(state, sessionEndedEvent({ sessionId: second, outcome: 'failed' }))
    expect(state.sessions[0]).toMatchObject({ state: 'failed' })
    state = projection.apply(state, sessionEndedEvent({ sessionId: fixtureDebugSessionId(3), outcome: 'disconnected' }))
    expect(state.sessions[1]).toMatchObject({ state: 'terminated' })
  })
})

describe('debugSessions service registration', () => {
  it('registers on ctx.sessionProjections and folds appended debug events', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(Debug)
    const session = ctx.sessions.create()

    expect(ctx.sessionProjections.snapshot(session).values.debugSessions).toEqual({ sessions: [] })

    session.append('debug/session-started', {
      sessionId: id,
      providerId: 'node',
      language: 'node',
      mode: 'launch',
      workspaceRoot: '/ws',
      adapterVersion: '1.0.0',
    })
    const values = ctx.sessionProjections.snapshot(session).values.debugSessions
    expect(values?.sessions).toHaveLength(1)
    expect(values?.sessions[0]).toMatchObject({ id, state: 'starting' })
  })
})
