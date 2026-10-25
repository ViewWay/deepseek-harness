import { describe, expect, it, vi } from 'vitest'
import { fixtureBackend, fixtureLaunchEnvironment, fixtureLaunchPlan, fixtureProvider } from '@deepseek-ai/dsh-debug-fixture'
import { fixtureSessionId } from '@deepseek-ai/dsh-debug-fixture'
import { DebugSessionRegistry } from '../src/registry.ts'
import { attachDebugSession, launchDebugSession } from '../src/launch.ts'
import { BreakpointRegistry, MemoryBreakpointStore } from '../src/breakpoints.ts'

describe('launchDebugSession', () => {
  it('resolves the provider, starts the adapter, applies breakpoints, and records durable events', async () => {
    const append = vi.fn()
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
    expect(environment.subprocess.spawns[0]).toMatchObject({ argv: ['adapter'] })
    expect(append).toHaveBeenCalledWith('debug/session-started', expect.objectContaining({ sessionId: expect.any(String) }), { ignorable: true })
    expect(append.mock.calls.some(([type]) => type === 'debug/stopped' || type === 'debug/session-ended')).toBe(true)
    expect(backend.dispose).not.toHaveBeenCalled()

    await breakpoints.setFile('ws-1', 'src/a.ts', [{ line: 4 }])
    expect(backend.setBreakpoints).toHaveBeenCalledOnce()
    expect(session.id).toMatch(/^debug-[0-9a-f]{16}$/)
  })

  it('appends session-ended with failed and disposes the backend when a stage throws', async () => {
    const append = vi.fn()
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
    const append = vi.fn()
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
        resolveAttach: vi.fn(async () => fixtureLaunchPlan()),
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
