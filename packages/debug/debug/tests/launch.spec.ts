import { describe, expect, it, vi } from 'vitest'
import { fixtureAttachPlan, fixtureBackend, fixtureLaunchEnvironment, fixtureLaunchPlan, fixtureProvider } from '@deepseek-ai/dsh-debug-fixture'
import { fixtureSessionId } from '@deepseek-ai/dsh-debug-fixture'
import { DebugSessionRegistry } from '../src/registry.ts'
import { attachDebugSession, launchDebugSession } from '../src/launch.ts'
import { BreakpointRegistry, MemoryBreakpointStore } from '../src/breakpoints.ts'
import type { DebugDurableAppend } from '../src/launch.ts'
import type { JsonValue } from '../src/types.ts'

/** Build the typed durable-append double every case in this file shares. */
function durableAppend() {
  return vi.fn<DebugDurableAppend>()
}

describe('launchDebugSession', () => {
  it('resolves the provider, starts the adapter, applies breakpoints, and records durable events', async () => {
    const append = durableAppend()
    const environment = fixtureLaunchEnvironment({ resolvedCommand: ['adapter'] })
    const backend = fixtureBackend()
    const breakpoints = new BreakpointRegistry(new MemoryBreakpointStore())
    const session = await launchDebugSession({
      request: {
        providerId: fixtureProvider('node', async () => fixtureLaunchPlan()).id,
        workspaceRoot: '/ws',
        workspaceId: 'ws-1',
        cwd: '/ws',
        program: 'src/a.ts',
        caller: { kind: 'user', sessionId: fixtureSessionId(1) },
      },
      provider: fixtureProvider('node', async () => fixtureLaunchPlan({ command: ['adapter'] })),
      environment,
      registry: new DebugSessionRegistry(),
      append,
      createBackend: async () => backend,
      breakpoints,
    })
    expect(['starting', 'running', 'stopped']).toContain(session.state)
    expect(environment.subprocess.spawns[0]).toMatchObject({ argv: ['adapter'], graceMs: 5000 })
    const started = append.mock.calls.find(([type]) => type === 'debug/session-started')
    expect(started).toBeDefined()
    const payload: Readonly<Record<string, JsonValue>> = started?.[1] ?? {}
    expect(typeof payload.sessionId).toBe('string')
    expect(started?.[2]).toEqual({ ignorable: true })
    expect(append.mock.calls.some(([type]) => type === 'debug/stopped' || type === 'debug/session-ended')).toBe(true)
    expect(backend.dispose).not.toHaveBeenCalled()

    await breakpoints.setFile('ws-1', 'src/a.ts', [{ line: 4 }])
    expect(backend.setBreakpoints).toHaveBeenCalledOnce()
    expect(session.id).toMatch(/^debug-[0-9a-f]{16}$/)
  })

  it('passes the injected terminate grace to the adapter spawn', async () => {
    const environment = fixtureLaunchEnvironment()
    await launchDebugSession({
      request: {
        providerId: fixtureProvider('node', async () => fixtureLaunchPlan()).id,
        workspaceRoot: '/ws',
        workspaceId: 'ws-1',
        cwd: '/ws',
        program: 'src/a.ts',
        caller: { kind: 'user', sessionId: fixtureSessionId(4) },
      },
      provider: fixtureProvider('node', async () => fixtureLaunchPlan({ command: ['adapter'] })),
      environment,
      registry: new DebugSessionRegistry(),
      append: vi.fn(),
      createBackend: async () => fixtureBackend(),
      terminateGraceMs: 250,
    })
    expect(environment.subprocess.spawns[0]).toMatchObject({ argv: ['adapter'], graceMs: 250 })
  })

  it('appends session-ended with failed and disposes the backend when a stage throws', async () => {
    const append = durableAppend()
    const backend = fixtureBackend()
    await expect(launchDebugSession({
      request: {
        providerId: fixtureProvider('node', async () => fixtureLaunchPlan()).id,
        workspaceRoot: '/ws',
        workspaceId: 'ws-1',
        cwd: '/ws',
        caller: { kind: 'agent', sessionId: fixtureSessionId(2) },
      },
      provider: fixtureProvider('node', async () => {
        throw new Error('no plan')
      }),
      environment: fixtureLaunchEnvironment(),
      registry: new DebugSessionRegistry(),
      append,
      createBackend: async () => backend,
    })).rejects.toMatchObject({ code: 'DEBUG_LAUNCH_FAILED' })
    expect(append).toHaveBeenCalledWith('debug/session-ended', expect.objectContaining({ outcome: 'failed' }), { ignorable: true })
    expect(backend.dispose).not.toHaveBeenCalled()
  })

  it('records termination without a stop through the same path on attach', async () => {
    const append = durableAppend()
    const session = await attachDebugSession({
      request: {
        providerId: fixtureProvider('node', async () => fixtureLaunchPlan()).id,
        workspaceRoot: '/ws',
        workspaceId: 'ws-1',
        processId: 42,
        caller: { kind: 'user', sessionId: fixtureSessionId(3) },
      },
      provider: {
        ...fixtureProvider('node', async () => fixtureLaunchPlan()),
        resolveAttach: vi.fn(async () => fixtureAttachPlan()),
      },
      environment: fixtureLaunchEnvironment(),
      registry: new DebugSessionRegistry(),
      append,
      createBackend: async () => fixtureBackend({ terminated: true }),
    })
    expect(session.state).toBe('terminated')
    expect(append).toHaveBeenCalledWith('debug/session-ended', expect.objectContaining({ outcome: 'terminated' }), { ignorable: true })
  })
})
