/**
 * The controller's bus-to-ring bridge: every committed live debug event is
 * forwarded into the replay ring under its session id — including the
 * interface-typed payloads spread into wire-safe JSON — and the bridge dies
 * with the controller's fiber.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { fixtureDebugBreakpointId, fixtureDebugSessionId, fixtureSessionId } from '@deepseek-ai/dsh-debug-fixture'
import Debug from '@deepseek-ai/dsh-debug/src/index.ts'
import type { DebugCapabilities } from '@deepseek-ai/dsh-debug/types'
import type { DebugEvent } from '@deepseek-ai/dsh-debug'
import { DEFAULT_DEBUG_EVENT_RING_LIMIT, DebugController } from '../src/index.ts'

const roots: Context[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose())) })

/** Mount the debug service and this controller on one fresh context. */
async function mount(): Promise<{ controller: DebugController; ctx: Context }> {
  const ctx = new Context()
  roots.push(ctx)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(Debug)
  const controller = new DebugController(ctx, { eventRingLimit: DEFAULT_DEBUG_EVENT_RING_LIMIT })
  return { controller, ctx }
}

/** One fully-specified capability snapshot with two declared members. */
const CAPABILITIES: DebugCapabilities = {
  supportsConditionalBreakpoints: true,
  supportsHitConditionalBreakpoints: false,
  supportsLogPoints: false,
  supportsFunctionBreakpoints: false,
  supportsDataBreakpoints: false,
  supportsInstructionBreakpoints: false,
  supportsExceptionFilterOptions: false,
  supportsStepBack: false,
  supportsRestartFrame: false,
  supportsSetVariable: false,
  supportsSetExpression: false,
  supportsCompletionsRequest: false,
  supportsModulesRequest: false,
  supportsLoadedSourcesRequest: false,
  supportsBreakpointLocationsRequest: false,
  supportsDisassembleRequest: false,
  supportsReadMemoryRequest: false,
  supportsWriteMemoryRequest: false,
  supportsTerminateRequest: true,
  supportsRestartRequest: false,
  supportsDelayedStackTraceLoading: false,
  supportsValueFormattingOptions: false,
  supportsEvaluateForHovers: false,
  supportsExceptionInfoRequest: false,
  supportsCancelRequest: false,
  supportsANSIStyling: false,
  supportsProgressReporting: false,
  supportsRunInTerminalRequest: false,
  supportsStartDebuggingRequest: false,
}

describe('debug controller event bridge', () => {
  it('forwards flat live events into the session replay ring', async () => {
    const { controller, ctx } = await mount()
    const first = fixtureDebugSessionId(51)
    ctx.debug.sessions.publish({ kind: 'session/starting', sessionId: first, workspaceId: 'ws' })
    ctx.debug.sessions.publish({ kind: 'session/terminated', sessionId: first, workspaceId: 'ws', actor: 'user' })
    const replay = controller.events(String(first), 0)
    expect(replay.expired).toBe(false)
    expect(replay.latestSeq).toBe(2)
    expect(replay.records.map(record => [record.seq, record.payload])).toEqual([
      [1, { kind: 'session/starting', sessionId: first, workspaceId: 'ws' }],
      [2, { kind: 'session/terminated', sessionId: first, workspaceId: 'ws', actor: 'user' }],
    ])
  })

  it('spreads interface-typed payloads into wire-safe JSON', async () => {
    const { controller, ctx } = await mount()
    const id = fixtureDebugSessionId(52)
    const events: readonly DebugEvent[] = [
      { kind: 'capabilities/changed', sessionId: id, workspaceId: 'ws', capabilities: CAPABILITIES },
      {
        kind: 'breakpoint/changed',
        sessionId: id,
        workspaceId: 'ws',
        result: {
          applied: [{ id: fixtureDebugBreakpointId(1), source: { workspaceRelativePath: 'src/a.ts', absolutePath: '/ws/src/a.ts' }, requestedLine: 4, verified: true, actualLine: 5 }],
          rejected: [],
        },
      },
      {
        kind: 'session/owner-changed',
        sessionId: id,
        workspaceId: 'ws',
        from: { kind: 'agent', sessionId: fixtureSessionId(2) },
        to: { kind: 'user', sessionId: fixtureSessionId(3) },
      },
    ]
    for (const event of events) ctx.debug.sessions.publish(event)
    const replay = controller.events(String(id), 0)
    expect(replay.records.map(record => record.payload)).toEqual([
      { kind: 'capabilities/changed', sessionId: id, workspaceId: 'ws', capabilities: CAPABILITIES },
      {
        kind: 'breakpoint/changed',
        sessionId: id,
        workspaceId: 'ws',
        result: {
          applied: [{ id: fixtureDebugBreakpointId(1), source: { workspaceRelativePath: 'src/a.ts', absolutePath: '/ws/src/a.ts' }, requestedLine: 4, verified: true, actualLine: 5 }],
          rejected: [],
        },
      },
      {
        kind: 'session/owner-changed',
        sessionId: id,
        workspaceId: 'ws',
        from: { kind: 'agent', sessionId: fixtureSessionId(2) },
        to: { kind: 'user', sessionId: fixtureSessionId(3) },
      },
    ])
  })

  it('keeps sessions separate and continues replay after a consumed cursor', async () => {
    const { controller, ctx } = await mount()
    const first = fixtureDebugSessionId(53)
    const second = fixtureDebugSessionId(54)
    ctx.debug.sessions.publish({ kind: 'session/running', sessionId: first, workspaceId: 'ws' })
    ctx.debug.sessions.publish({ kind: 'session/stopped', sessionId: second, workspaceId: 'ws' })
    ctx.debug.sessions.publish({ kind: 'session/failed', sessionId: second, workspaceId: 'ws' })
    expect(controller.events(String(first), 0).records.map(record => record.payload))
      .toEqual([{ kind: 'session/running', sessionId: first, workspaceId: 'ws' }])
    const afterFirst = controller.events(String(second), 0)
    expect(afterFirst.latestSeq).toBe(2)
    const afterCursor = controller.events(String(second), afterFirst.latestSeq)
    expect(afterCursor.records).toEqual([])
    expect(afterCursor.latestSeq).toBe(2)
  })

  it('stops recording once the controller fiber is disposed', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(SessionProjectionRegistry)
      await ctx.plugin(Debug)
      const controller = new DebugController(ctx, { eventRingLimit: DEFAULT_DEBUG_EVENT_RING_LIMIT })
      const id = fixtureDebugSessionId(55)
      const bus = ctx.debug.sessions
      bus.publish({ kind: 'session/starting', sessionId: id, workspaceId: 'ws' })
      expect(controller.events(String(id), 0).latestSeq).toBe(1)
      await ctx.fiber.dispose()
      bus.publish({ kind: 'session/running', sessionId: id, workspaceId: 'ws' })
      expect(controller.events(String(id), 0).latestSeq).toBe(1)
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
