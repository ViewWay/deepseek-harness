/**
 * The Python provider: interpreter-validated launch and attach resolution in
 * the frozen plan shapes, with debugpy option whitelisting.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Debug, { DebugProviderId } from '@deepseek-ai/dsh-debug'
import type { DebugAttachRequest, DebugLaunchRequest } from '@deepseek-ai/dsh-debug'
import { parseAdapterManifest } from '@deepseek-ai/dsh-debug-adapter-manager'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { fixtureDebugEnvironment, fixtureSessionId } from '@deepseek-ai/dsh-debug-fixture'
import { PY_ADAPTER_MANIFEST, apply, inject, name, pythonDebugProvider } from '../src/index.ts'

const environment = fixtureDebugEnvironment({
  resolvedCommand: ['/venv/bin/python', '-m', 'debugpy.adapter'],
})

type PythonLaunchOverrides = Partial<Omit<DebugLaunchRequest, 'module' | 'program'>> & { module?: string | undefined; program?: string | undefined }

function launchRequest(init: PythonLaunchOverrides = {}): DebugLaunchRequest {
  const { module: overrideModule, program: overrideProgram, ...rest } = init
  return {
    providerId: DebugProviderId('python'),
    workspaceRoot: '/ws',
    workspaceId: 'ws-1',
    cwd: '/ws',
    ...(overrideModule !== undefined
      ? { module: overrideModule }
      : 'module' in init ? {} : { module: 'app' }),
    ...(overrideProgram !== undefined ? { program: overrideProgram } : {}),
    ...(rest.args !== undefined ? { args: rest.args } : { args: ['--serve'] }),
    ...(rest.env !== undefined ? { env: rest.env } : { env: { APP_ENV: 'test' } }),
    ...(rest.caller !== undefined ? { caller: rest.caller } : { caller: { kind: 'user', sessionId: fixtureSessionId(1) } }),
    ...(rest.providerOptions !== undefined ? { providerOptions: rest.providerOptions } : { providerOptions: { python: '/usr/bin/python3', justMyCode: true, subProcess: false } }),
  }
}

describe('pythonDebugProvider resolution', () => {
  it('resolves a module launch with interpreter and provider options', async () => {
    const plan = await pythonDebugProvider.resolveLaunch(launchRequest(), environment)
    expect(plan.dapRequest).toMatchObject({
      request: 'launch',
      module: 'app',
      args: ['--serve'],
      justMyCode: true,
      subProcess: false,
      python: '/usr/bin/python3',
    })
    expect(plan.target).toMatchObject({ executable: '/usr/bin/python3', args: ['-m', 'app', '--serve'] })
    expect(plan.requires).toEqual(['python'])
  })

  it('resolves a program launch with an absolutized script path', async () => {
    const plan = await pythonDebugProvider.resolveLaunch(launchRequest({
      module: undefined,
      program: 'src/main.py',
    }), environment)
    expect(plan.dapRequest).toMatchObject({ program: '/ws/src/main.py' })
    expect(plan.target).toMatchObject({ args: ['/ws/src/main.py', '--serve'] })
  })

  it('rejects missing interpreter, both or neither entry, and unknown options', async () => {
    await expect(pythonDebugProvider.resolveLaunch(launchRequest({
      providerOptions: { justMyCode: true },
    }), environment)).rejects.toMatchObject({ code: 'DEBUG_INVALID_CONFIG' })
    await expect(pythonDebugProvider.resolveLaunch(launchRequest({
      program: 'src/main.py',
    }), environment)).rejects.toMatchObject({ code: 'DEBUG_INVALID_CONFIG' })
    await expect(pythonDebugProvider.resolveLaunch(launchRequest({
      module: undefined,
    }), environment)).rejects.toMatchObject({ code: 'DEBUG_INVALID_CONFIG' })
    await expect(pythonDebugProvider.resolveLaunch(launchRequest({
      providerOptions: { python: '/usr/bin/python3', gevent: true },
    }), environment)).rejects.toMatchObject({ code: 'DEBUG_INVALID_CONFIG' })
  })

  it('supports attach by process id or port, rejecting both and neither', async () => {
    const attach = (init: Partial<DebugAttachRequest>): DebugAttachRequest => ({
      providerId: DebugProviderId('python'),
      workspaceRoot: '/ws',
      workspaceId: 'ws-1',
      caller: { kind: 'user', sessionId: fixtureSessionId(1) },
      ...init,
    })
    const byPid = await pythonDebugProvider.resolveAttach(attach({ processId: 42 }), environment)
    expect(byPid.dapRequest).toMatchObject({ request: 'attach', processId: 42 })
    const byPort = await pythonDebugProvider.resolveAttach(attach({ port: 5678 }), environment)
    expect(byPort.dapRequest).toMatchObject({ request: 'attach', listen: { port: 5678 } })
    await expect(pythonDebugProvider.resolveAttach(attach({ processId: 1, port: 2 }), environment))
      .rejects.toMatchObject({ code: 'DEBUG_INVALID_CONFIG' })
    await expect(pythonDebugProvider.resolveAttach(attach({}), environment))
      .rejects.toMatchObject({ code: 'DEBUG_INVALID_CONFIG' })
  })
})

describe('pythonDebugProvider registration', () => {
  it('registers through apply and releases on dispose', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(Debug)
    const fiber = await ctx.plugin({ name, inject, apply })
    expect(ctx.debug.providers().map(provider => provider.id)).toContain(DebugProviderId('python'))
    await fiber.dispose()
    expect(ctx.debug.providers()).toHaveLength(0)
  })

  it('exposes a pypi manifest that validates against the manager', () => {
    const manifest = parseAdapterManifest(PY_ADAPTER_MANIFEST)
    expect(manifest.version).toBe('1.8.22')
    expect(manifest.source).toEqual({ kind: 'pypi', package: 'debugpy' })
    expect(manifest.platforms).toBeUndefined()
    expect(manifest.command).toEqual(['python', '-m', 'debugpy.adapter'])
  })
})
