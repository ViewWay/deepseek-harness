/**
 * The native (Rust/C/C++) provider: lldb-dap launch and attach resolution in
 * the frozen plan shapes, with the verified LLVM 23.1.4 manifest registration.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { parseAdapterManifest } from '@deepseek-ai/dsh-debug-adapter-manager'
import DebugAdapterManager from '@deepseek-ai/dsh-debug-adapter-manager'
import Debug, { DebugProviderId } from '@deepseek-ai/dsh-debug'
import type { DebugAttachRequest, DebugLaunchRequest } from '@deepseek-ai/dsh-debug'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { fixtureDebugEnvironment, fixtureSessionId } from '@deepseek-ai/dsh-debug-fixture'
import { apply, inject, name, nativeDebugProvider } from '../src/index.ts'
import { NATIVE_ADAPTER_MANIFEST } from '../src/index.ts'

const environment = fixtureDebugEnvironment({ resolvedCommand: ['lldb-dap'], resolvedVersion: '23.1.4' })

function launchRequest(init: Partial<DebugLaunchRequest> = {}): DebugLaunchRequest {
  return {
    providerId: DebugProviderId('native'),
    workspaceRoot: '/ws',
    workspaceId: 'ws-1',
    cwd: '/ws',
    program: 'target/debug/app',
    args: ['--flag'],
    env: { RUST_BACKTRACE: '1' },
    stopOnEntry: true,
    caller: { kind: 'user', sessionId: fixtureSessionId(1) },
    ...init,
  }
}

describe('nativeDebugProvider resolution', () => {
  it('resolves a launch plan with the absolutized program and stopOnEntry', async () => {
    const plan = await nativeDebugProvider.resolveLaunch(launchRequest(), environment)
    expect(plan.dapRequest).toMatchObject({
      request: 'launch',
      program: '/ws/target/debug/app',
      args: ['--flag'],
      stopOnEntry: true,
    })
    expect(plan.adapter.command).toEqual(['lldb-dap'])
    expect(plan.requires).toEqual(['ptrace'])
    expect(plan.manifestVersion).toBe('23.1.4')
  })

  it('rejects launch without a program and with unknown provider options', async () => {
    await expect(nativeDebugProvider.resolveLaunch(launchRequest({ program: undefined }), environment))
      .rejects.toMatchObject({ code: 'DEBUG_INVALID_CONFIG' })
    await expect(nativeDebugProvider.resolveLaunch(launchRequest({ providerOptions: { miMode: 'gdb' } }), environment))
      .rejects.toMatchObject({ code: 'DEBUG_INVALID_CONFIG' })
  })

  it('supports attach by process id or port, rejecting both and neither', async () => {
    const attach = (init: Partial<DebugAttachRequest>): DebugAttachRequest => ({
      providerId: DebugProviderId('native'),
      workspaceRoot: '/ws',
      workspaceId: 'ws-1',
      caller: { kind: 'user', sessionId: fixtureSessionId(1) },
      ...init,
    })
    const byPid = await nativeDebugProvider.resolveAttach(attach({ processId: 42 }), environment)
    expect(byPid.dapRequest).toMatchObject({ request: 'attach', pid: 42 })
    expect(byPid.requires).toEqual(['ptrace'])
    const byPort = await nativeDebugProvider.resolveAttach(attach({ port: 1234 }), environment)
    expect(byPort.dapRequest).toMatchObject({ request: 'attach', attachCommands: ['process connect connect://127.0.0.1:1234'] })
    await expect(nativeDebugProvider.resolveAttach(attach({ processId: 1, port: 2 }), environment))
      .rejects.toMatchObject({ code: 'DEBUG_INVALID_CONFIG' })
    await expect(nativeDebugProvider.resolveAttach(attach({}), environment))
      .rejects.toMatchObject({ code: 'DEBUG_INVALID_CONFIG' })
  })
})

describe('nativeDebugProvider registration', () => {
  it('exposes an LLVM manifest that validates without darwin-x64', () => {
    const manifest = parseAdapterManifest(NATIVE_ADAPTER_MANIFEST)
    expect(manifest.version).toBe('23.1.4')
    expect(manifest.license).toBe('Apache-2.0 WITH LLVM-exception')
    expect(manifest.platforms?.['darwin-x64']).toBeUndefined()
    expect(manifest.platforms?.['linux-x64']).toMatchObject({
      archive: 'LLVM-23.1.4-Linux-X64.tar.xz',
      sha256: '25d814fda50d5fb0084b42be09605d8b1595d49d5e2e03a3345d7e112ff6f9f3',
      sizeBytes: 2017061664,
    })
    expect(Object.keys(manifest.platforms ?? {}).sort()).toEqual(['darwin-arm64', 'linux-arm64', 'linux-x64', 'win32-x64'])
  })

  it('registers the provider and manifest through apply and releases on dispose', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(Debug)
    await ctx.plugin(DebugAdapterManager)
    const fiber = await ctx.plugin({ name, inject, apply })
    expect(ctx.debug.providers().map(provider => provider.id)).toContain(DebugProviderId('native'))
    expect(ctx.debugAdapters.list()).toHaveLength(1)
    await fiber.dispose()
    expect(ctx.debug.providers()).toHaveLength(0)
    expect(ctx.debugAdapters.list()).toHaveLength(0)
  })
})
