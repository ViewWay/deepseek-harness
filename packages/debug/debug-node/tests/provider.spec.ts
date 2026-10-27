/**
 * The Node provider: frozen-shape launch and attach resolution, node-specific
 * config validation, and the js-debug manifest registration with its verified
 * digest.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { parseAdapterManifest } from '@deepseek-ai/dsh-debug-adapter-manager'
import DebugAdapterManager from '@deepseek-ai/dsh-debug-adapter-manager'
import Debug, { DebugProviderId } from '@deepseek-ai/dsh-debug'
import type { DebugLaunchRequest } from '@deepseek-ai/dsh-debug'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { fixtureDebugEnvironment, fixtureSessionId } from '@deepseek-ai/dsh-debug-fixture'
import { NODE_ADAPTER_MANIFEST, nodeDebugProvider } from '../src/index.ts'
import { apply, inject, name } from '../src/index.ts'

const environment = fixtureDebugEnvironment()

/** Field overrides for the launch-request factory; undefined removes a field. */
type LaunchOverrides = { [K in keyof DebugLaunchRequest]?: DebugLaunchRequest[K] | undefined }

function launchRequest(init: LaunchOverrides = {}): DebugLaunchRequest {
  const program = 'program' in init ? init.program : 'src/a.ts'
  return {
    providerId: DebugProviderId('node'),
    workspaceRoot: '/ws',
    workspaceId: 'ws-1',
    cwd: '/ws',
    ...(program !== undefined ? { program } : {}),
    ...(init.module !== undefined ? { module: init.module } : {}),
    ...('args' in init && init.args !== undefined ? { args: init.args } : { args: ['--flag'] }),
    ...(init.env !== undefined ? { env: init.env } : { env: { NODE_ENV: 'test' } }),
    ...(init.stopOnEntry !== undefined ? { stopOnEntry: init.stopOnEntry } : { stopOnEntry: true }),
    ...(init.providerOptions !== undefined ? { providerOptions: init.providerOptions } : {}),
    caller: { kind: 'user', sessionId: fixtureSessionId(1) },
  }
}

describe('nodeDebugProvider resolution', () => {
  it('resolves a launch plan with program, args, env, cwd, and required adapter', async () => {
    const plan = await nodeDebugProvider.resolveLaunch(launchRequest(), environment)
    expect(plan.dapRequest).toMatchObject({
      type: 'node',
      request: 'launch',
      program: '/ws/src/a.ts',
      args: ['--flag'],
      cwd: '/ws',
      stopOnEntry: true,
    })
    expect(plan.adapter.command).toEqual(['node', 'js-debug/src/dapDebugServer.js'])
    expect(plan.target).toMatchObject({ executable: 'node', args: ['/ws/src/a.ts', '--flag'], cwd: '/ws' })
    expect(plan.requires).toEqual(['processControl'])
    expect(plan.manifestVersion).toBe('1.140.0')
    expect(plan.failureHint).toContain('adapter')
  })

  it('resolves a module launch and merges provider options into the DAP request', async () => {
    const plan = await nodeDebugProvider.resolveLaunch(launchRequest({
      program: undefined,
      module: 'src/cli.ts',
      providerOptions: { runtimeExecutable: 'node24', sourceMaps: true },
    }), environment)
    expect(plan.dapRequest).toMatchObject({ module: '/ws/src/cli.ts', runtimeExecutable: 'node24', sourceMaps: true })
    expect(plan.target.args).toEqual(['/ws/src/cli.ts', '--flag'])
  })

  it('rejects launch without exactly one of program or module and unknown options', async () => {
    await expect(nodeDebugProvider.resolveLaunch(launchRequest({ program: undefined }), environment))
      .rejects.toMatchObject({ code: 'DEBUG_INVALID_CONFIG' })
    await expect(nodeDebugProvider.resolveLaunch(launchRequest({ module: 'src/cli.ts' }), environment))
      .rejects.toMatchObject({ code: 'DEBUG_INVALID_CONFIG' })
    await expect(nodeDebugProvider.resolveLaunch(launchRequest({ providerOptions: { nope: true } }), environment))
      .rejects.toMatchObject({ code: 'DEBUG_INVALID_CONFIG' })
  })

  it('supports attach by process id, port, or URL', async () => {
    const byPid = await nodeDebugProvider.resolveAttach({
      providerId: DebugProviderId('node'),
      workspaceRoot: '/ws',
      workspaceId: 'ws-1',
      processId: 42,
      caller: { kind: 'user', sessionId: fixtureSessionId(1) },
    }, environment)
    expect(byPid.dapRequest).toMatchObject({ request: 'attach', processId: 42 })
    expect(byPid.requires).toEqual(['processControl'])

    const byPort = await nodeDebugProvider.resolveAttach({
      providerId: DebugProviderId('node'),
      workspaceRoot: '/ws',
      workspaceId: 'ws-1',
      port: 9229,
      caller: { kind: 'agent', sessionId: fixtureSessionId(2) },
    }, environment)
    expect(byPort.dapRequest).toMatchObject({ request: 'attach', port: 9229 })
    expect(byPort.requires).toEqual([])

    await expect(nodeDebugProvider.resolveAttach({
      providerId: DebugProviderId('node'),
      workspaceRoot: '/ws',
      workspaceId: 'ws-1',
      processId: 1,
      port: 2,
      url: 'ws://localhost:9229',
      caller: { kind: 'user', sessionId: fixtureSessionId(3) },
    }, environment)).rejects.toMatchObject({ code: 'DEBUG_INVALID_CONFIG' })
  })
})

describe('nodeDebugProvider registration', () => {
  it('exposes the provider and a manifest that validates against the manager', () => {
    expect(nodeDebugProvider.id).toBe(DebugProviderId('node'))
    expect(nodeDebugProvider.extensions).toContain('.ts')
    const manifest = parseAdapterManifest(NODE_ADAPTER_MANIFEST)
    expect(manifest.version).toBe('1.140.0')
    expect(manifest.source).toMatchObject({ kind: 'archive' })
    expect(manifest.platforms?.['linux-x64']).toMatchObject({ sizeBytes: 1249709 })
  })

  it('registers the provider and manifest through apply and releases on dispose', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(Debug)
    await ctx.plugin(DebugAdapterManager)
    const fiber = await ctx.plugin({ name, inject, apply })
    expect(ctx.debug.providers()).toHaveLength(1)
    expect(ctx.debugAdapters.list()).toHaveLength(1)
    await fiber.dispose()
    expect(ctx.debug.providers()).toHaveLength(0)
    expect(ctx.debugAdapters.list()).toHaveLength(0)
  })
})
