/** The debug view client service: session seeding, event polling, cursor resync, action dispatch, and notices. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RemoteError, TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import { apply, inject } from '../src/client/index.ts'
import type { DebugViewService } from '../src/client/debug-service.ts'

/** One session as the session list scripts it; the service reads id and state only. */
interface ScriptedSession {
  readonly id: string
  readonly state: 'starting' | 'running' | 'stopped' | 'terminated' | 'failed'
}

/** One replay record as the events Remote scripts it. */
interface ScriptedRecord {
  readonly seq: number
  readonly sessionId: string
  readonly payload: object
}

/** The execution remotes' scriptable returns, beyond their recorded calls. */
interface ScriptedExecution {
  readonly continueResult?: RemoteResult<{ readonly kind: 'running' }>
  readonly continueRejection?: unknown
}

/** Everything the scripted `remote.debug` namespace records and returns. */
interface ScriptedDebug extends ScriptedExecution {
  readonly sessions: readonly ScriptedSession[]
  readonly recordsBySession: Readonly<Record<string, readonly ScriptedRecord[]>>
  readonly sessionListFailureFirst?: RemoteResult<readonly ScriptedSession[]>
  readonly sessionListRejectsFirst?: unknown
  readonly eventsFailure?: RemoteResult<never>
  readonly calls: { sessionList: number[]; events: [sessionId: string, after: number][] }
}

/** The execution remote mocks mount returns for call assertions. */
interface ExecutionMocks {
  readonly executionContinue: (sessionId: string) => Promise<RemoteResult<unknown>>
  readonly executionPause: (sessionId: string) => Promise<RemoteResult<unknown>>
  readonly executionStep: (sessionId: string, kind: 'over' | 'in' | 'out' | 'back') => Promise<RemoteResult<unknown>>
  readonly executionRestartFrame: (sessionId: string, frameId: string) => Promise<RemoteResult<unknown>>
}

/** Resolve one scripted Remote success value. */
const ok = <T>(value: T): Promise<RemoteResult<T>> => Promise.resolve({ ok: true as const, value })

describe('debug view service', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  /**
   * Mount the client plugin over one scripted `remote.debug` namespace and
   * the minimal locale and slots doubles the tool cards need.
   * @param scripted - the namespace's returns and call log.
   * @returns the mounted root context, the debug view service, and the
   *   execution remote mocks.
   */
  async function mount(scripted: ScriptedDebug): Promise<{
    ctx: Context
    service: DebugViewService
    execution: ExecutionMocks
  }> {
    const ctx = new Context()
    const execution: ExecutionMocks = {
      executionContinue: vi.fn(() => {
        if (scripted.continueRejection !== undefined) {
          // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- the non-Error rejection is the scenario
          return Promise.reject(scripted.continueRejection)
        }
        return scripted.continueResult === undefined
          ? ok({ kind: 'running' })
          : Promise.resolve(scripted.continueResult)
      }),
      executionPause: vi.fn(() => ok(undefined)),
      executionStep: vi.fn(() => ok({ kind: 'running' })),
      executionRestartFrame: vi.fn(() => ok(undefined)),
    }
    new TestRemote(ctx, {
      debug: {
        sessionList: () => {
          scripted.calls.sessionList.push(scripted.calls.sessionList.length)
          if (scripted.sessionListRejectsFirst !== undefined && scripted.calls.sessionList.length === 1) {
            // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- the non-Error rejection is the scenario
            return Promise.reject(scripted.sessionListRejectsFirst)
          }
          if (scripted.sessionListFailureFirst !== undefined && scripted.calls.sessionList.length === 1) {
            return Promise.resolve(scripted.sessionListFailureFirst)
          }
          return ok(scripted.sessions)
        },
        events: (sessionId: string, after: number) => {
          scripted.calls.events.push([sessionId, after])
          if (scripted.eventsFailure !== undefined && after !== 0) return Promise.resolve(scripted.eventsFailure)
          const records = scripted.recordsBySession[sessionId] ?? []
          const pending = records.filter(record => record.seq > after)
          const latestSeq = Math.max(after, records.at(-1)?.seq ?? after)
          return ok({ records: pending, expired: false, latestSeq })
        },
        ...execution,
      },
    })
    ctx.provide('locale', {
      register: () => () => {},
      bind: () => (key: string) => key,
    })
    ctx.provide('slots', {
      inject: (_name: string, callback: () => () => void) => callback(),
      register: () => () => {},
    })
    await ctx.plugin({ inject: [...inject], apply }).await()
    await vi.advanceTimersByTimeAsync(0)
    const service = ctx.get('debugView')!
    if (service === undefined) throw new Error('debugView service did not start')
    return { ctx, service, execution }
  }

  it('seeds sessions from the session list and folds replayed capabilities', async () => {
    const scripted: ScriptedDebug = {
      sessions: [{ id: 'debug-1', state: 'running' }, { id: 'debug-2', state: 'stopped' }],
      recordsBySession: {
        'debug-1': [{
          seq: 1,
          sessionId: 'debug-1',
          payload: { kind: 'capabilities/changed', sessionId: 'debug-1', workspaceId: 'ws', capabilities: { supportsTerminateRequest: true } },
        }],
      },
      calls: { sessionList: [], events: [] },
    }
    const { service } = await mount(scripted)
    expect(service.store.state.sessionStates).toEqual({ 'debug-1': 'running', 'debug-2': 'stopped' })
    expect(service.store.state.selectedSessionId).toBe('debug-1')
    expect(service.store.state.capabilities?.supportsTerminateRequest).toBe(true)
    expect(service.store.state.capabilities?.supportsStepBack).toBe(false)
    // The second session was replayed too, from its own zero cursor.
    expect(scripted.calls.events).toEqual([['debug-1', 0], ['debug-2', 0]])
  })

  it('advances the per-session cursor and replays only newer records on later ticks', async () => {
    const records: ScriptedRecord[] = [
      { seq: 1, sessionId: 'debug-1', payload: { kind: 'console/output', sessionId: 'debug-1', workspaceId: 'ws', text: 'first', truncated: false } },
    ]
    const scripted: ScriptedDebug = {
      sessions: [{ id: 'debug-1', state: 'running' }],
      recordsBySession: { 'debug-1': records },
      calls: { sessionList: [], events: [] },
    }
    const { service } = await mount(scripted)
    expect(service.store.state.consoleEntries.map(entry => entry.text)).toEqual(['first'])
    records.push(
      { seq: 2, sessionId: 'debug-1', payload: { kind: 'console/output', sessionId: 'debug-1', workspaceId: 'ws', text: 'second', truncated: false } },
      { seq: 3, sessionId: 'debug-1', payload: { kind: 'session/stopped', sessionId: 'debug-1', workspaceId: 'ws' } },
      // A kind the view cannot present decodes to nothing and the fold skips it.
      { seq: 4, sessionId: 'debug-1', payload: { kind: 'breakpoint/changed', sessionId: 'debug-1', workspaceId: 'ws', result: {} } },
    )
    await vi.advanceTimersByTimeAsync(1000)
    expect(scripted.calls.events.at(-1)).toEqual(['debug-1', 1])
    expect(service.store.state.consoleEntries.map(entry => entry.text)).toEqual(['first', 'second'])
    // A stopped payload without stop fields folds the session state, not a stop snapshot.
    expect(service.store.state.sessionStates['debug-1']).toBe('stopped')
    expect(service.store.state.stop).toBeUndefined()
  })

  it('folds a stopped payload with stop fields as the stop snapshot', async () => {
    const scripted: ScriptedDebug = {
      sessions: [{ id: 'debug-1', state: 'stopped' }],
      recordsBySession: {
        'debug-1': [{
          seq: 1,
          sessionId: 'debug-1',
          payload: {
            kind: 'session/stopped', sessionId: 'debug-1', workspaceId: 'ws',
            reason: 'breakpoint', threadId: '3', source: { workspaceRelativePath: 'src/a.ts' }, line: 4, column: 2, frameId: 'frame-1',
          },
        }],
      },
      calls: { sessionList: [], events: [] },
    }
    const { service } = await mount(scripted)
    expect(service.store.state.stop).toEqual({
      sessionId: 'debug-1', reason: 'breakpoint', threadId: 3, frameId: 'frame-1', source: 'src/a.ts', line: 4, column: 2,
    })
    expect(service.store.state.selectedFrameId).toBe('frame-1')
  })

  it('dispatches toolbar actions onto the execution remotes', async () => {
    const scripted: ScriptedDebug = {
      sessions: [{ id: 'debug-1', state: 'running' }],
      recordsBySession: {},
      calls: { sessionList: [], events: [] },
    }
    const { service, execution } = await mount(scripted)
    service.onAction('continue', 'debug-1')
    service.onAction('pause', 'debug-1')
    service.onAction('stepOver', 'debug-1')
    service.onAction('stepIn', 'debug-1')
    service.onAction('stepOut', 'debug-1')
    service.onAction('stepBack', 'debug-1')
    await vi.advanceTimersByTimeAsync(0)
    expect(execution.executionContinue).toHaveBeenCalledWith('debug-1')
    expect(execution.executionPause).toHaveBeenCalledWith('debug-1')
    expect(execution.executionStep).toHaveBeenCalledWith('debug-1', 'over')
    expect(execution.executionStep).toHaveBeenCalledWith('debug-1', 'in')
    expect(execution.executionStep).toHaveBeenCalledWith('debug-1', 'out')
    expect(execution.executionStep).toHaveBeenCalledWith('debug-1', 'back')
    expect(service.notices.getSnapshot()).toEqual([])
  })

  it('restarts the selected frame from the store and reports the missing frame', async () => {
    const scripted: ScriptedDebug = {
      sessions: [{ id: 'debug-1', state: 'stopped' }],
      recordsBySession: {
        'debug-1': [{
          seq: 1,
          sessionId: 'debug-1',
          payload: {
            kind: 'session/stopped', sessionId: 'debug-1', workspaceId: 'ws',
            reason: 'step', threadId: 1, source: 'src/a.ts', line: 7, column: 1, frameId: 'frame-4',
          },
        }],
      },
      calls: { sessionList: [], events: [] },
    }
    const { service, execution } = await mount(scripted)
    service.onAction('restartFrame', 'debug-1')
    expect(execution.executionRestartFrame).toHaveBeenCalledWith('debug-1', 'frame-4')
    service.store.apply({ kind: 'session/continued', sessionId: 'debug-1' })
    service.onAction('restartFrame', 'debug-1')
    const notices = service.notices.getSnapshot()
    expect(notices).toHaveLength(1)
    expect(notices[0]?.reason).toBe('action-unavailable')
  })

  it('reports actions without a remote and a missing session selection', async () => {
    const scripted: ScriptedDebug = {
      sessions: [],
      recordsBySession: {},
      calls: { sessionList: [], events: [] },
    }
    const { service } = await mount(scripted)
    service.onAction('start', 'debug-1')
    service.onAction('restart', 'debug-1')
    service.onAction('stop', 'debug-1')
    service.onAction('disconnect', 'debug-1')
    service.onAction('continue', '')
    const notices = service.notices.getSnapshot()
    expect(notices.map(notice => notice.reason)).toEqual([
      'action-unavailable', 'action-unavailable', 'action-unavailable', 'action-unavailable', 'action-unavailable',
    ])
    expect(notices[0]?.message).toContain('start')
    expect(notices[4]?.message).toContain('no debug session is selected')
  })

  it('surfaces a failed dispatch as an action-failed notice', async () => {
    const scripted: ScriptedDebug = {
      sessions: [{ id: 'debug-1', state: 'stopped' }],
      recordsBySession: {},
      continueResult: {
        ok: false,
        error: new RemoteError('gateway/internal', 'debug session is not active: debug-1', {}),
      },
      calls: { sessionList: [], events: [] },
    }
    const { service } = await mount(scripted)
    service.onAction('continue', 'debug-1')
    await vi.advanceTimersByTimeAsync(0)
    const notices = service.notices.getSnapshot()
    expect(notices).toHaveLength(1)
    expect(notices[0]?.reason).toBe('action-failed')
    expect(notices[0]?.message).toContain('continue')
  })

  it('resets an expired replay cursor to zero and refolds the next tick', async () => {
    const scripted: ScriptedDebug = {
      sessions: [{ id: 'debug-1', state: 'running' }],
      recordsBySession: {
        'debug-1': [{ seq: 5, sessionId: 'debug-1', payload: { kind: 'session/running', sessionId: 'debug-1', workspaceId: 'ws' } }],
      },
      // The wire folds the controller's domain error to gateway/internal
      // with its message intact; the stable message is the client's signal.
      eventsFailure: { ok: false, error: new RemoteError('gateway/internal', 'debug event cursor expired for session debug-1', {}) },
      calls: { sessionList: [], events: [] },
    }
    const { service } = await mount(scripted)
    // The first tick replayed seq 5 and advanced the cursor; the second tick
    // fails with the expired cursor, and the third refolds from zero.
    await vi.advanceTimersByTimeAsync(2000)
    expect(service.notices.getSnapshot().filter(notice => notice.reason === 'poll-failed')).toEqual([])
    expect(scripted.calls.events.at(-1)).toEqual(['debug-1', 0])
  })

  it('reports poll failures and keeps polling', async () => {
    const scripted: ScriptedDebug = {
      sessions: [],
      recordsBySession: {},
      sessionListFailureFirst: { ok: false, error: new RemoteError('gateway/internal', 'host unavailable', {}) },
      calls: { sessionList: [], events: [] },
    }
    const { service } = await mount(scripted)
    const first = service.notices.getSnapshot()
    expect(first).toHaveLength(1)
    expect(first[0]?.reason).toBe('poll-failed')
    // The failure stopped neither the interval nor the read: the second read
    // succeeds and no second notice lands.
    await vi.advanceTimersByTimeAsync(1000)
    expect(scripted.calls.sessionList).toHaveLength(2)
    expect(service.notices.getSnapshot()).toHaveLength(1)
  })

  it('contains an assembly fault and keeps the interval alive', async () => {
    const scripted: ScriptedDebug = {
      sessions: [{ id: 'debug-1', state: 'running' }],
      recordsBySession: {},
      sessionListRejectsFirst: new Error('debug namespace is unmounted'),
      calls: { sessionList: [], events: [] },
    }
    const { service } = await mount(scripted)
    const first = service.notices.getSnapshot()
    expect(first).toHaveLength(1)
    expect(first[0]?.reason).toBe('poll-failed')
    expect(first[0]?.message).toContain('debug event poll failed')
    await vi.advanceTimersByTimeAsync(1000)
    expect(scripted.calls.sessionList).toHaveLength(2)
    expect(service.notices.getSnapshot()).toHaveLength(1)
  })

  it('bounds the notice ring to the newest twenty', async () => {
    const scripted: ScriptedDebug = {
      sessions: [{ id: 'debug-1', state: 'running' }],
      recordsBySession: {},
      calls: { sessionList: [], events: [] },
    }
    const { service } = await mount(scripted)
    for (let index = 0; index < 21; index += 1) service.onAction('start', 'debug-1')
    const notices = service.notices.getSnapshot()
    expect(notices).toHaveLength(20)
    expect(notices.at(-1)?.message).toContain('start')
  })

  it('notices subscribers on reports and stops on dispose', async () => {
    const scripted: ScriptedDebug = {
      sessions: [],
      recordsBySession: {},
      calls: { sessionList: [], events: [] },
    }
    const { service } = await mount(scripted)
    const seen: number[] = []
    const dispose = service.notices.subscribe(() => { seen.push(service.notices.getSnapshot().length) })
    service.onAction('start', 'debug-1')
    expect(seen).toEqual([1])
    dispose()
    service.onAction('start', 'debug-1')
    expect(seen).toEqual([1])
    expect(service.notices.getSnapshot()).toHaveLength(2)
  })

  it('reports a non-expired events failure without resetting the cursor', async () => {
    const scripted: ScriptedDebug = {
      sessions: [{ id: 'debug-1', state: 'running' }],
      recordsBySession: {
        'debug-1': [{ seq: 1, sessionId: 'debug-1', payload: { kind: 'session/running', sessionId: 'debug-1', workspaceId: 'ws' } }],
      },
      eventsFailure: { ok: false, error: new RemoteError('gateway/internal', 'replay backend unavailable', {}) },
      calls: { sessionList: [], events: [] },
    }
    const { service } = await mount(scripted)
    await vi.advanceTimersByTimeAsync(1000)
    const notices = service.notices.getSnapshot()
    expect(notices).toHaveLength(1)
    expect(notices[0]?.reason).toBe('poll-failed')
    expect(notices[0]?.message).toContain('debug events for debug-1 failed')
    // The cursor survived the failure, so the next replay resumes after seq 1.
    expect(scripted.calls.events.at(-1)).toEqual(['debug-1', 1])
  })

  it('skips a tick while the previous one is still in flight', async () => {
    let release: (() => void) | undefined
    const scripted: ScriptedDebug = {
      sessions: [{ id: 'debug-1', state: 'running' }],
      recordsBySession: {
        'debug-1': [{ seq: 1, sessionId: 'debug-1', payload: { kind: 'session/running', sessionId: 'debug-1', workspaceId: 'ws' } }],
      },
      calls: { sessionList: [], events: [] },
    }
    const ctx = new Context()
    new TestRemote(ctx, {
      debug: {
        sessionList: () => {
          scripted.calls.sessionList.push(scripted.calls.sessionList.length)
          return scripted.calls.sessionList.length === 1
            ? new Promise((resolve) => { release = () => { resolve(ok(scripted.sessions)) } })
            : ok(scripted.sessions)
        },
        events: (sessionId: string, after: number) => {
          scripted.calls.events.push([sessionId, after])
          return ok({ records: [], expired: false, latestSeq: after })
        },
      },
    })
    ctx.provide('locale', { register: () => () => {}, bind: () => (key: string) => key })
    ctx.provide('slots', { inject: (_name: string, callback: () => () => void) => callback(), register: () => () => {} })
    await ctx.plugin({ inject: [...inject], apply }).await()
    // The first tick parks inside its session-list read; a later interval
    // fire must not stack a second one on top.
    await vi.advanceTimersByTimeAsync(1000)
    expect(scripted.calls.sessionList).toHaveLength(1)
    release?.()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1000)
    expect(scripted.calls.sessionList).toHaveLength(2)
  })

  it('names a non-Error poll rejection and a rejected dispatch', async () => {
    const dispatch = await mount({
      sessions: [{ id: 'debug-1', state: 'running' }],
      recordsBySession: {},
      continueRejection: 'namespace unmounted',
      calls: { sessionList: [], events: [] },
    })
    dispatch.service.onAction('continue', 'debug-1')
    await vi.advanceTimersByTimeAsync(0)
    expect(dispatch.service.notices.getSnapshot()).toEqual([
      { reason: 'action-failed', message: 'continue: namespace unmounted' },
    ])
    const errored = await mount({
      sessions: [{ id: 'debug-1', state: 'running' }],
      recordsBySession: {},
      continueRejection: new Error('debug namespace is unmounted'),
      calls: { sessionList: [], events: [] },
    })
    errored.service.onAction('continue', 'debug-1')
    await vi.advanceTimersByTimeAsync(0)
    expect(errored.service.notices.getSnapshot()).toEqual([
      { reason: 'action-failed', message: 'continue: debug namespace is unmounted' },
    ])
    const poll = await mount({
      sessions: [{ id: 'debug-1', state: 'running' }],
      recordsBySession: {},
      sessionListRejectsFirst: 'namespace gone',
      calls: { sessionList: [], events: [] },
    })
    expect(poll.service.notices.getSnapshot()).toEqual([
      { reason: 'poll-failed', message: 'debug event poll failed: namespace gone' },
    ])
  })
})
