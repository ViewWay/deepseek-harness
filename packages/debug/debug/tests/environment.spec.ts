/**
 * Execution-environment probing: facts come from the world's own services —
 * never host child_process or fs — and required capabilities fail typed.
 */

import { describe, expect, it, vi } from 'vitest'
import type { DebugExecutionCapability } from '@deepseek-ai/dsh-debug'
import { fixtureDebugEnvironment } from '@deepseek-ai/dsh-debug-fixture'
import type { DebugEnvironmentProbe } from '../src/environment.ts'
import { probeDebugEnvironment } from '../src/environment.ts'

function subprocessDouble(overrides: {
  terminalEnvironment?: () => Promise<{ platform: 'posix' | 'windows'; defaultShell?: string }>
  resolveExecutable?: (command: string) => Promise<string>
} = {}) {
  const subprocess = fixtureDebugEnvironment().subprocess
  vi.spyOn(subprocess, 'terminalEnvironment').mockImplementation(
    overrides.terminalEnvironment ?? (async () => ({ platform: 'posix' as const, defaultShell: '/bin/sh' })),
  )
  vi.spyOn(subprocess, 'resolveExecutable').mockImplementation(
    overrides.resolveExecutable ?? (async (command: string) => `/usr/bin/${command}`),
  )
  return subprocess
}

interface ProbeOverrides {
  subprocess?: ReturnType<typeof subprocessDouble>
  platformKey?: string
  requiredCapabilities?: readonly DebugExecutionCapability[]
  sandboxAllowsProcessControl?: boolean
}

function probeInit(overrides: ProbeOverrides = {}): DebugEnvironmentProbe {
  return {
    subprocess: overrides.subprocess ?? subprocessDouble(),
    fs: fixtureDebugEnvironment().fs,
    workspaceRoot: '/ws',
    platformKey: overrides.platformKey ?? 'linux-x64',
    adapters: { resolve: vi.fn(async () => ({
      command: ['node', 'adapter.js'], args: [], env: {}, version: '1.0.0',
      platform: 'linux-x64', source: 'managed' as const, executablePath: '/adapters/node',
    })) },
    requiredCapabilities: overrides.requiredCapabilities ?? [],
    ...(overrides.sandboxAllowsProcessControl !== undefined
      ? { sandboxAllowsProcessControl: overrides.sandboxAllowsProcessControl }
      : {}),
  }
}

describe('probeDebugEnvironment', () => {
  it('derives world facts from the subprocess service, never the host', async () => {
    const subprocess = subprocessDouble()
    const terminalSpy = vi.spyOn(subprocess, 'terminalEnvironment')
    const environment = await probeDebugEnvironment(probeInit({ subprocess }))
    expect(environment.platform).toBe('linux')
    expect(environment.arch).toBe('x64')
    expect(environment.pathSeparator).toBe('/')
    expect(environment.shell).toBe('/bin/sh')
    expect(environment.workspaceRoot).toBe('/ws')
    expect(environment.cwd).toBe('/ws')
    expect(terminalSpy).toHaveBeenCalled()
  })

  it('maps windows platform keys and shells', async () => {
    const environment = await probeDebugEnvironment(probeInit({
      platformKey: 'win32-x64',
      subprocess: subprocessDouble({
        terminalEnvironment: async () => ({ platform: 'windows' as const, defaultShell: 'pwsh' }),
      }),
    }))
    expect(environment.platform).toBe('win32')
    expect(environment.pathSeparator).toBe('\\')
    expect(environment.shell).toBe('pwsh')
  })

  it('rejects unknown platform keys loud', async () => {
    await expect(probeDebugEnvironment(probeInit({ platformKey: 'plan9-arm' })))
      .rejects.toMatchObject({ code: 'DEBUG_ADAPTER_UNSUPPORTED' })
  })

  it('verifies interpreter capabilities through the world PATH', async () => {
    const resolveExecutable = async (command: string) => {
      if (command === 'go') throw new Error('not found')
      return `/usr/bin/${command}`
    }
    await expect(probeDebugEnvironment(probeInit({
      requiredCapabilities: ['python', 'go'],
      subprocess: subprocessDouble({ resolveExecutable }),
    }))).rejects.toMatchObject({ code: 'DEBUG_ADAPTER_UNSUPPORTED' })
  })

  it('fails sandboxed worlds that deny required process capabilities', async () => {
    await expect(probeDebugEnvironment(probeInit({
      requiredCapabilities: ['processControl'],
      sandboxAllowsProcessControl: false,
    }))).rejects.toMatchObject({ code: 'DEBUG_SANDBOX_DENIED' })
  })

  it('rejects ptrace-style capabilities on worlds that cannot host them', async () => {
    await expect(probeDebugEnvironment(probeInit({
      platformKey: 'win32-x64',
      requiredCapabilities: ['ptrace'],
    }))).rejects.toMatchObject({ code: 'DEBUG_ADAPTER_UNSUPPORTED' })
  })
})
