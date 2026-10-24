/**
 * The session registry: workspace-scoped reads, commit-then-publish state
 * changes, idempotent disposal, and the `Debug` service surface backed by it.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import Debug from '@deepseek-ai/dsh-debug'
import { fixtureDebugSessionId, fixtureSessionId } from '@deepseek-ai/dsh-debug-fixture'
import { DebugProviderId } from '@deepseek-ai/dsh-debug'
import type { DebugEvent } from '@deepseek-ai/dsh-debug'
import { DebugSessionRegistry } from '../src/registry.ts'
import { sessionRecord } from './helpers/records.ts'

describe('DebugSessionRegistry', () => {
  it('lists by workspace and rejects cross-workspace access', () => {
    const registry = new DebugSessionRegistry()
    const id = fixtureDebugSessionId(1)
    registry.add(sessionRecord({ id, workspaceId: 'ws-1' }))
    expect(registry.list({ workspaceId: 'ws-1' })).toHaveLength(1)
    expect(() => registry.get(id, { workspaceId: 'ws-2' }))
      .toThrow(expect.objectContaining({ code: 'DEBUG_WORKSPACE_MISMATCH' }))
  })

  it('lists in insertion order and filters by owning session', () => {
    const registry = new DebugSessionRegistry()
    const first = sessionRecord({ id: fixtureDebugSessionId(1), workspaceId: 'ws-1' })
    const second = sessionRecord({
      id: fixtureDebugSessionId(2),
      workspaceId: 'ws-1',
      ownerSessionId: fixtureSessionId(7),
    })
    registry.add(first)
    registry.add(second)
    expect(registry.list()).toEqual([first, second])
    expect(registry.list({ ownerSessionId: fixtureSessionId(7) })).toEqual([second])
    expect(registry.get(fixtureDebugSessionId(99))).toBeUndefined()
  })

  it('rejects duplicate session ids', () => {
    const registry = new DebugSessionRegistry()
    registry.add(sessionRecord({ id: fixtureDebugSessionId(1), workspaceId: 'ws-1' }))
    expect(() => {
      registry.add(sessionRecord({ id: fixtureDebugSessionId(1), workspaceId: 'ws-2' }))
    }).toThrow(expect.objectContaining({ code: 'DEBUG_CONFLICT' }))
  })

  it('disposes a session once and publishes termination after commit', async () => {
    const registry = new DebugSessionRegistry()
    const entry = sessionRecord({ id: fixtureDebugSessionId(1), workspaceId: 'ws-1' })
    const seen: string[] = []
    registry.events.subscribe({ workspaceId: 'ws-1' }, event => seen.push(event.kind))
    registry.add(entry)
    await registry.remove(entry.id, 'user')
    await registry.remove(entry.id, 'user')
    expect(entry.dispose).toHaveBeenCalledOnce()
    expect(seen.at(-1)).toBe('session/terminated')
  })

  it('commits state before publishing and maps states to event kinds', () => {
    const registry = new DebugSessionRegistry()
    const entry = sessionRecord({ id: fixtureDebugSessionId(1), workspaceId: 'ws-1' })
    const observed: Array<{ kind: string; stateAtPublish: string }> = []
    registry.add(entry)
    registry.events.subscribe({ sessionId: entry.id }, (event) => {
      observed.push({ kind: event.kind, stateAtPublish: entry.state })
    })
    registry.setState(entry.id, 'running')
    registry.setState(entry.id, 'stopped')
    expect(observed).toEqual([
      { kind: 'session/running', stateAtPublish: 'running' },
      { kind: 'session/stopped', stateAtPublish: 'stopped' },
    ])
  })

  it('contains listener failures so publishing never fails the operation', () => {
    const registry = new DebugSessionRegistry()
    const entry = sessionRecord({ id: fixtureDebugSessionId(1), workspaceId: 'ws-1' })
    const working: string[] = []
    registry.events.subscribe({}, () => {
      throw new Error('listener failure is contained')
    })
    registry.events.subscribe({}, event => working.push(event.kind))
    expect(() => {
      registry.add(entry)
    }).not.toThrow()
    expect(working).toEqual(['session/starting'])
  })

  it('stops delivery after the subscribe disposer runs', () => {
    const registry = new DebugSessionRegistry()
    const seen: string[] = []
    const dispose = registry.events.subscribe({}, event => seen.push(event.kind))
    dispose()
    registry.add(sessionRecord({ id: fixtureDebugSessionId(1), workspaceId: 'ws-1' }))
    expect(seen).toEqual([])
  })
})

describe('Debug service session surface', () => {
  async function mount() {
    const ctx = new Context()
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(Debug)
    return { ctx, debug: ctx.debug }
  }

  it('lists registry records as session infos and resolves one live session', async () => {
    const { debug } = await mount()
    const id = fixtureDebugSessionId(1)
    debug.sessions.add(sessionRecord({
      id,
      workspaceId: 'ws-1',
      ownerSessionId: fixtureSessionId(3),
    }))
    expect(debug.list({ workspaceId: 'ws-1' })).toEqual([{
      id,
      providerId: DebugProviderId('node'),
      workspaceId: 'ws-1',
      state: 'starting',
      ownerSessionId: fixtureSessionId(3),
    }])
    const session = debug.get(id)
    expect(session).toBeDefined()
    expect(debug.get(id)).toBe(session)
    await session?.terminate()
    expect(debug.get(id)).toBeUndefined()
    expect(debug.list({ workspaceId: 'ws-1' })).toEqual([])
  })

  it('rejects launch and attach as unavailable until the backend lands', async () => {
    const { debug } = await mount()
    const request = {
      providerId: DebugProviderId('node'),
      workspaceRoot: '/ws',
      workspaceId: 'ws-1',
      cwd: '/ws',
      caller: { kind: 'user' as const, sessionId: fixtureSessionId(1) },
    }
    await expect(debug.launch(request)).rejects.toMatchObject({ code: 'DEBUG_UNAVAILABLE' })
    await expect(debug.attach(request)).rejects.toMatchObject({ code: 'DEBUG_UNAVAILABLE' })
  })

  it('exposes the live event source of the session registry', async () => {
    const { debug } = await mount()
    const seen: DebugEvent['kind'][] = []
    const dispose = debug.events.subscribe({ workspaceId: 'ws-1' }, event => seen.push(event.kind))
    debug.sessions.add(sessionRecord({ id: fixtureDebugSessionId(1), workspaceId: 'ws-1' }))
    dispose()
    expect(seen).toEqual(['session/starting'])
  })
})
