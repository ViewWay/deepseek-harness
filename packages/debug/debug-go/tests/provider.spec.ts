/**
 * The Go provider: delve-validated launch and attach resolution in the frozen
 * plan shapes, with the verified v1.27.2 manifest registration.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { parseAdapterManifest } from '@deepseek-ai/dsh-debug-adapter-manager'
import DebugAdapterManager from '@deepseek-ai/dsh-debug-adapter-manager'
import Debug, { DebugProviderId } from '@deepseek-ai/dsh-debug'
import type { DebugAttachRequest, DebugLaunchRequest } from '@deepseek-ai/dsh-debug'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { fixtureDebugEnvironment, fixtureSessionId } from '@deepseek-ai/dsh-debug-fixture'
import { GO_ADAPTER_MANIFEST, apply, goDebugProvider, inject, name } from '../src/index.ts'

const environment = fixtureDebugEnvironment({ resolvedCommand: ['dlv', 'dap'], resolvedVersion: '1.27.2' })

function launchRequest(init: Partial<DebugLaunchRequest> & { program?: string | undefined } = {}): DebugLaunchRequest {
  const { program: overrideProgram, ...rest } = init
  return {
    providerId: DebugProviderId('go'),
    workspaceRoot: '/ws',
    workspaceId: 'ws-1',
    cwd: '/ws',
    ...(overrideProgram !== undefined
      ? { program: overrideProgram }
      : 'program' in init ? {} : { program: './cmd/app' }),
    ...(rest.args !== undefined ? { args: rest.args } : { args: ['--flag'] }),
    ...(rest.env !== undefined ? { env: rest.env } : { env: { GOFLAGS: '-mod=mod' } }),
    ...(rest.caller !== undefined ? { caller: rest.caller } : { caller: { kind: 'user', sessionId: fixtureSessionId(1) } }),
    ...(rest.providerOptions !== undefined ? { providerOptions: rest.providerOptions } : { providerOptions: { mode: 'debug', buildFlags: ['-tags', 'dev'] } }),
    ...(rest.module !== undefined ? { module: rest.module } : {}),
  }
}

describe('goDebugProvider resolution', () => {
  it('resolves a launch plan with program, delve mode, and build flags', async () => {
    const plan = await goDebugProvider.resolveLaunch(launchRequest(), environment)
    expect(plan.dapRequest).toMatchObject({
      request: 'launch',
      mode: 'debug',
      program: '/ws/./cmd/app',
      buildFlags: ['-tags', 'dev'],
      args: ['--flag'],
    })
    expect(plan.adapter.command).toEqual(['dlv', 'dap'])
    expect(plan.target).toMatchObject({ executable: 'dlv', args: ['dap'] })
    expect(plan.requires).toEqual(['go'])
    expect(plan.manifestVersion).toBe('1.27.2')
  })

  it('resolves a package launch and rejects unknown modes and options', async () => {
    const plan = await goDebugProvider.resolveLaunch(launchRequest({
      program: undefined,
      module: 'example.com/app/cmd/app',
    }), environment)
    expect(plan.dapRequest).toMatchObject({ request: 'launch', package: 'example.com/app/cmd/app' })

    await expect(goDebugProvider.resolveLaunch(launchRequest({
      providerOptions: { mode: 'replay' },
    }), environment)).rejects.toMatchObject({ code: 'DEBUG_INVALID_CONFIG' })
    await expect(goDebugProvider.resolveLaunch(launchRequest({
      providerOptions: { nope: true },
    }), environment)).rejects.toMatchObject({ code: 'DEBUG_INVALID_CONFIG' })
  })

  it('rejects launch with neither or both of program and module', async () => {
    await expect(goDebugProvider.resolveLaunch(launchRequest({ program: undefined }), environment))
      .rejects.toMatchObject({ code: 'DEBUG_INVALID_CONFIG' })
    await expect(goDebugProvider.resolveLaunch(launchRequest({ module: 'example.com/app' }), environment))
      .rejects.toMatchObject({ code: 'DEBUG_INVALID_CONFIG' })
  })

  it('supports attach by process id or port, rejecting both and neither', async () => {
    const attach = (init: Partial<DebugAttachRequest>): DebugAttachRequest => ({
      providerId: DebugProviderId('go'),
      workspaceRoot: '/ws',
      workspaceId: 'ws-1',
      caller: { kind: 'user', sessionId: fixtureSessionId(1) },
      ...init,
    })
    const byPid = await goDebugProvider.resolveAttach(attach({ processId: 42 }), environment)
    expect(byPid.dapRequest).toMatchObject({ request: 'attach', processId: 42 })
    expect(byPid.requires).toEqual(['go'])
    const byPort = await goDebugProvider.resolveAttach(attach({ port: 2345 }), environment)
    expect(byPort.dapRequest).toMatchObject({ request: 'attach', port: 2345 })
    await expect(goDebugProvider.resolveAttach(attach({ processId: 1, port: 2 }), environment))
      .rejects.toMatchObject({ code: 'DEBUG_INVALID_CONFIG' })
    await expect(goDebugProvider.resolveAttach(attach({}), environment))
      .rejects.toMatchObject({ code: 'DEBUG_INVALID_CONFIG' })
  })
})

describe('goDebugProvider registration', () => {
  it('exposes a delve manifest that validates with per-platform digests', () => {
    const manifest = parseAdapterManifest(GO_ADAPTER_MANIFEST)
    expect(manifest.version).toBe('1.27.2')
    expect(manifest.source).toMatchObject({ kind: 'archive' })
    expect(manifest.platforms?.['linux-x64']).toMatchObject({
      archive: 'dlv_1.27.2_linux_amd64.tar.gz',
      sha256: '30783eb68dc1598d965491cc97762270cd63ce13f09d0cac22faa7e3eafc1b9c',
      sizeBytes: 12970664,
    })
    expect(Object.keys(manifest.platforms ?? {}).sort()).toEqual(['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-x64'])
  })

  it('registers the provider and manifest through apply and releases on dispose', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(Debug)
    await ctx.plugin(DebugAdapterManager)
    const fiber = await ctx.plugin({ name, inject, apply })
    expect(ctx.debug.providers().map(provider => provider.id)).toContain(DebugProviderId('go'))
    expect(ctx.debugAdapters.list()).toHaveLength(1)
    await fiber.dispose()
    expect(ctx.debug.providers()).toHaveLength(0)
    expect(ctx.debugAdapters.list()).toHaveLength(0)
  })
})
