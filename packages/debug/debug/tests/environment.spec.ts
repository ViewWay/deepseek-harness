/**
 * Execution-environment probing: facts come from the world's own services —
 * never host child_process or fs — and required capabilities fail typed.
 */

import { describe, expect, it, vi } from 'vitest'
import { fixtureDebugEnvironment } from '@deepseek-ai/dsh-debug-fixture'
import { probeDebugEnvironment } from '../src/environment.ts'

function subprocessDouble(overrides: Record<string, unknown> = {}) {
  return {
    resolveExecutable: vi.fn(async (command: string) => `/usr/bin/${command}`),
    terminalEnvironment: vi.fn(async () => ({ platform: 'posix' as const, defaultShell: '/bin/sh' })),
    spawn: vi.fn(),
    spawnTerminal: vi.fn(),
    ...overrides,
  }
}

function probeInit(overrides: Record<string, unknown> = {}) {
  return {
    subprocess: subprocessDouble(),
    fs: fixtureDebugEnvironment().fs,
    workspaceRoot: '/ws',
    platformKey: 'linux-x64',
    adapters: { resolve: vi.fn(async () => ({
      command: ['node', 'adapter.js'], args: [], env: {}, version: '1.0.0',
      platform: 'linux-x64', source: 'managed' as const, executablePath: '/adapters/node',
    })) },
    requiredCapabilities: [],
    ...overrides,
  }
}

describe('probeDebugEnvironment', () => {
  it('derives world facts from the subprocess service, never the host', async () => {
    const subprocess = subprocessDouble()
    const environment = await probeDebugEnvironment(probeInit({ subprocess }))
    expect(environment.platform).toBe('linux')
    expect(environment.arch).toBe('x64')
    expect(environment.pathSeparator).toBe('/')
    expect(environment.shell).toBe('/bin/sh')
    expect(environment.workspaceRoot).toBe('/ws')
    expect(environment.cwd).toBe('/ws')
    expect(subprocess.terminalEnvironment).toHaveBeenCalled()
  })

  it('maps windows platform keys and shells', async () => {
    const environment = await probeDebugEnvironment(probeInit({
      platformKey: 'win32-x64',
      subprocess: subprocessDouble({
        terminalEnvironment: vi.fn(async () => ({ platform: 'windows' as const, defaultShell: 'pwsh' })),
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
    const resolveExecutable = vi.fn(async (command: string) => {
      if (command === 'go') throw new Error('not found')
      return `/usr/bin/${command}`
    })
    await expect(probeDebugEnvironment(probeInit({
      requiredCapabilities: ['python', 'go'],
      subprocess: subprocessDouble({ resolveExecutable }),
    }))).rejects.toMatchObject({ code: 'DEBUG_ADAPTER_UNSUPPORTED' })
    expect(resolveExecutable).toHaveBeenCalledWith('python3')
    expect(resolveExecutable).toHaveBeenCalledWith('go')
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
