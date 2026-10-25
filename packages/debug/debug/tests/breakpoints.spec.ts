import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { fixtureDebugSessionId } from '@deepseek-ai/dsh-debug-fixture'
import Debug from '../src/index.ts'
import { BreakpointRegistry, MemoryBreakpointStore } from '../src/breakpoints.ts'
import type { DebugBreakpointInput } from '@deepseek-ai/dsh-debug'
import { sessionRecord } from './helpers/records.ts'

describe('BreakpointRegistry', () => {
  it('replaces all breakpoints in one file and applies them to matching sessions', async () => {
    const store = new MemoryBreakpointStore()
    const registry = new BreakpointRegistry(store)
    const apply = vi.fn(async () => ({ applied: [], rejected: [] }))
    const unbind = registry.bindSession(sessionRecord({ id: fixtureDebugSessionId(1), workspaceId: 'ws-1' }), apply)
    const other = vi.fn(async () => ({ applied: [], rejected: [] }))
    registry.bindSession(sessionRecord({ id: fixtureDebugSessionId(2), workspaceId: 'ws-2' }), other)

    await registry.setFile('ws-1', 'src/a.ts', [
      { line: 4 }, { line: 5, condition: 'x > 1' }, { line: 6, logMessage: 'x={x}' },
    ])

    expect(apply).toHaveBeenCalledOnce()
    expect(apply).toHaveBeenCalledWith({ source: 'src/a.ts', breakpoints: [
      { line: 4 }, { line: 5, condition: 'x > 1' }, { line: 6, logMessage: 'x={x}' },
    ] })
    expect(other).not.toHaveBeenCalled()
    expect(await store.load('ws-1', 'src/a.ts')).toHaveLength(3)

    unbind()
    await registry.setFile('ws-1', 'src/a.ts', [{ line: 9 }])
    expect(apply).toHaveBeenCalledOnce()
    expect(await store.load('ws-1', 'src/a.ts')).toEqual([{ line: 9 }])
  })

  it('rejects a breakpoint count above the configured limit', async () => {
    const registry = new BreakpointRegistry(new MemoryBreakpointStore(), { maxPerFile: 1 })
    await expect(registry.setFile('ws-1', 'src/a.ts', [{ line: 1 }, { line: 2 }]))
      .rejects.toMatchObject({ code: 'DEBUG_BREAKPOINT_LIMIT' })
  })

  it('rejects non-1-based lines and empty sets clear the file', async () => {
    const store = new MemoryBreakpointStore()
    const registry = new BreakpointRegistry(store)
    await expect(registry.setFile('ws-1', 'src/a.ts', [{ line: 0 }])).rejects.toMatchObject({ code: 'DEBUG_INVALID_CONFIG' })
    await registry.setFile('ws-1', 'src/a.ts', [{ line: 4 }])
    await registry.setFile('ws-1', 'src/a.ts', [])
    expect(await store.load('ws-1', 'src/a.ts')).toEqual([])
  })

  it('normalizes workspace-relative paths before persisting', async () => {
    const store = new MemoryBreakpointStore()
    const registry = new BreakpointRegistry(store)
    await registry.setFile('ws-1', './src/../src/a.ts', [{ line: 4 }])
    expect(await store.load('ws-1', 'src/a.ts')).toEqual([{ line: 4 }])
  })

  it('wires the registry into the service with configured limits and live events', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(Debug, { maxBreakpointsPerFile: 1 })
    const debug = ctx.debug
    const seen: string[] = []
    debug.events.subscribe({ kind: 'breakpoint/changed' }, (event) => {
      seen.push(event.kind)
    })
    const apply = vi.fn(async () => ({ applied: [], rejected: [] }))
    debug.breakpoints.bindSession(sessionRecord({ id: fixtureDebugSessionId(3), workspaceId: 'ws-9' }), apply)
    await expect(debug.breakpoints.setFile('ws-9', 'a.ts', [{ line: 1 }, { line: 2 }]))
      .rejects.toMatchObject({ code: 'DEBUG_BREAKPOINT_LIMIT' })
    await debug.breakpoints.setFile('ws-9', 'a.ts', [{ line: 1 }])
    expect(seen).toEqual(['breakpoint/changed'])
    expect(apply).toHaveBeenCalledOnce()
  })

  it('records adapter-verified results per session', async () => {
    const registry = new BreakpointRegistry(new MemoryBreakpointStore())
    const inputs: readonly DebugBreakpointInput[] = [{ line: 4 }, { line: 7 }]
    const apply = vi.fn(async () => ({
      applied: [{ id: 'debug-0000000000000001', requestedLine: 4, verified: true, actualLine: 5 }],
      rejected: [{ id: 'debug-0000000000000002', requestedLine: 7, verified: false }],
    }))
    registry.bindSession(sessionRecord({ id: fixtureDebugSessionId(1), workspaceId: 'ws-1' }), apply)
    const results = await registry.setFile('ws-1', 'a.ts', inputs)
    expect(results[0]?.sessionResults.applied[0]).toMatchObject({ requestedLine: 4, actualLine: 5 })
    expect(results[0]?.sessionResults.rejected[0]).toMatchObject({ requestedLine: 7, verified: false })
  })
})
