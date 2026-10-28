/**
 * Sandbox execution-world lane. Real confinement — launching an adapter inside
 * the configured sandbox profile and observing a live ptrace denial from the
 * confined world — needs a nested `sandbox-exec` world the host sandbox rule
 * forbids, so following the SSH stub this spec drives the published
 * world-capability gate (`probeDebugEnvironment`) against a stub world: a
 * granted sandbox probes through to the launch environment, a denying sandbox
 * rejects `DEBUG_SANDBOX_DENIED` for both process-control flavors, and a world
 * that cannot host ptrace rejects `DEBUG_ADAPTER_UNSUPPORTED` even when the
 * sandbox grants control. The confined-world matrix belongs to the CI platform
 * lanes.
 */
import { describe, expect, it, vi } from 'vitest'
import { probeDebugEnvironment } from '@deepseek-ai/dsh-debug'
import type { DebugEnvironmentProbe, DebugExecutionCapability } from '@deepseek-ai/dsh-debug'
import { fixtureDebugEnvironment } from '@deepseek-ai/dsh-debug-fixture'

/** The node lane's launch requirement. */
const PROCESS_CONTROL: readonly DebugExecutionCapability[] = ['processControl']

/** The native lane's tracer requirement. */
const PTRACE: readonly DebugExecutionCapability[] = ['ptrace']

/**
 * Builds the stub sandbox world: the subprocess service reports the world's
 * shell, and every other fact comes from the probe arguments.
 * @param overrides - the required capabilities, the platform key, and the sandbox's process-control grant.
 * @returns the probe for the stub world.
 */
function sandboxWorld(overrides: {
  readonly requiredCapabilities: readonly DebugExecutionCapability[]
  readonly platformKey?: string
  readonly sandboxAllowsProcessControl?: boolean
}): DebugEnvironmentProbe {
  const world = fixtureDebugEnvironment()
  vi.spyOn(world.subprocess, 'terminalEnvironment').mockImplementation(
    async () => ({ platform: 'posix' as const, defaultShell: '/bin/sh' }),
  )
  return {
    subprocess: world.subprocess,
    fs: world.fs,
    workspaceRoot: '/ws',
    platformKey: overrides.platformKey ?? 'linux-x64',
    adapters: world.adapters,
    requiredCapabilities: overrides.requiredCapabilities,
    ...(overrides.sandboxAllowsProcessControl !== undefined
      ? { sandboxAllowsProcessControl: overrides.sandboxAllowsProcessControl }
      : {}),
  }
}

describe('sandbox debug e2e (world-capability stub)', () => {
  it('probes a granted sandbox through to the launch environment', async () => {
    const environment = await probeDebugEnvironment(sandboxWorld({
      requiredCapabilities: [...PROCESS_CONTROL, ...PTRACE],
      sandboxAllowsProcessControl: true,
    }))
    expect(environment.platform).toBe('linux')
    expect(environment.arch).toBe('x64')
    expect(environment.requiredCapabilities).toEqual(['processControl', 'ptrace'])
    expect(environment.shell).toBe('/bin/sh')
  })

  it('denies launch from a sandbox that forbids process control', async () => {
    await expect(probeDebugEnvironment(sandboxWorld({
      requiredCapabilities: PROCESS_CONTROL,
      sandboxAllowsProcessControl: false,
    }))).rejects.toMatchObject({ code: 'DEBUG_SANDBOX_DENIED' })
  })

  it('denies the ptrace requirement from the same denying sandbox', async () => {
    await expect(probeDebugEnvironment(sandboxWorld({
      requiredCapabilities: PTRACE,
      sandboxAllowsProcessControl: false,
    }))).rejects.toMatchObject({ code: 'DEBUG_SANDBOX_DENIED' })
  })

  it('rejects ptrace on a world that cannot host it even when the sandbox grants control', async () => {
    await expect(probeDebugEnvironment(sandboxWorld({
      requiredCapabilities: PTRACE,
      platformKey: 'win32-x64',
      sandboxAllowsProcessControl: true,
    }))).rejects.toMatchObject({ code: 'DEBUG_ADAPTER_UNSUPPORTED' })
  })
})
