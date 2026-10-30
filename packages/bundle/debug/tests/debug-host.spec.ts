/**
 * The production launch host's behavior: a real launch composes the provider
 * plan, managed-adapter resolution with install-on-miss, the spawned
 * adapter's stdio, the DAP handshake through a scripted in-test adapter, the
 * session registry, backend registration, capability publication, and the
 * caller session's durable `debug/*` events. Attach rides the same path, and
 * a missing caller session or provider fails typed before anything spawns.
 */
import { PassThrough } from 'node:stream'
import type { Readable, Writable } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import Debug, { DebugError } from '@deepseek-ai/dsh-debug/src/index.ts'
import type { DebugEvent, DebugProviderId, ResolvedDebugAdapter } from '@deepseek-ai/dsh-debug'
import { decodeDapFrames, encodeDapFrame } from '@deepseek-ai/dsh-debug-dap'
import type { DapMessage } from '@deepseek-ai/dsh-debug-dap'
import { DebugAdapterManager } from '@deepseek-ai/dsh-debug-adapter-manager'
import type { DebugAdapterInstallCall, DebugAdapterResolveCall } from '@deepseek-ai/dsh-debug-adapter-manager'
import { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { fixtureAttachPlan, fixtureLaunchPlan, fixtureProvider } from '@deepseek-ai/dsh-debug-fixture'
import { DebugHost } from '../src/debug-host.ts'

const roots: Context[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose())) })

/** One scripted DAP adapter: answers the handshake and stops at a fixed frame. */
class ScriptedAdapter {
  /** Every request command the adapter served, in arrival order. */
  readonly commands: string[] = []
  private seq = 0
  private rest: Uint8Array = new Uint8Array(0)
  private readonly toClient: Writable

  constructor(toClient: Writable, fromClient: Readable) {
    this.toClient = toClient
    void this.read(fromClient)
  }

  private async read(stream: Readable): Promise<void> {
    for await (const chunk of stream) {
      const chunkBytes = chunk as Uint8Array
      const combined = new Uint8Array(this.rest.length + chunkBytes.length)
      combined.set(this.rest)
      combined.set(chunkBytes, this.rest.length)
      const decoding = decodeDapFrames(combined)
      this.rest = decoding.rest
      for (const message of decoding.messages) this.serve(message)
    }
  }

  private serve(message: DapMessage): void {
    if (message.type !== 'request') return
    this.commands.push(message.command)
    switch (message.command) {
      case 'initialize':
        this.write({ seq: ++this.seq, type: 'response', request_seq: message.seq, success: true, command: 'initialize', body: { supportsConfigurationDoneRequest: true, supportsTerminateRequest: true } })
        this.write({ seq: ++this.seq, type: 'event', event: 'initialized' })
        return
      case 'configurationDone':
        this.write({ seq: ++this.seq, type: 'response', request_seq: message.seq, success: true, command: 'configurationDone' })
        return
      case 'launch':
      case 'attach':
        this.write({ seq: ++this.seq, type: 'response', request_seq: message.seq, success: true, command: message.command })
        this.write({ seq: ++this.seq, type: 'event', event: 'stopped', body: { reason: 'breakpoint', threadId: 1, description: 'fixture stop' } })
        return
      case 'stackTrace':
        this.write({
          seq: ++this.seq,
          type: 'response',
          request_seq: message.seq,
          success: true,
          command: 'stackTrace',
          body: { stackFrames: [{ id: 1, name: 'frame0', line: 4, column: 2, source: { path: '/ws/src/a.ts' } }], totalFrames: 1 },
        })
        return
      default:
        this.write({ seq: ++this.seq, type: 'response', request_seq: message.seq, success: true, command: message.command, body: {} })
    }
  }

  private write(message: DapMessage): void {
    this.toClient.write(encodeDapFrame(message))
  }
}

/** The local subprocess double: records spawns and serves each with a scripted adapter. */
class HarnessSubprocess extends SubprocessRuntime {
  /** Every spawn spec, in call order. */
  readonly spawns: { argv: readonly string[]; cwd: string; graceMs: number }[] = []
  /** The scripted adapters serving each spawn, in spawn order. */
  readonly adapters: ScriptedAdapter[] = []

  constructor() {
    super(new Context())
  }

  override resolveExecutable(): Promise<never> {
    throw new Error('harness subprocess cannot resolve executables')
  }

  override async terminalEnvironment(): Promise<{ platform: 'posix' | 'windows'; defaultShell?: string }> {
    return { platform: 'posix', defaultShell: '/bin/sh' }
  }

  override spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    this.spawns.push({ argv: spec.argv, cwd: spec.cwd, graceMs: spec.graceMs })
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    this.adapters.push(new ScriptedAdapter(stdout, stdin))
    return {
      stdin,
      stdout,
      stderr: new PassThrough(),
      control: undefined,
      collected: {},
      done: Promise.resolve({ exitCode: 0, signal: null }),
      terminate: () => {},
      waitForExit: () => Promise.resolve(true),
    }
  }

  override spawnTerminal(): Promise<never> {
    throw new Error('harness subprocess cannot spawn terminals')
  }
}

/** The adapter-manager double: resolve fails with `DEBUG_ADAPTER_NOT_FOUND` until install runs. */
class HarnessAdapterManager extends DebugAdapterManager {
  /** Every resolve call, in order. */
  readonly resolves: { providerId: DebugProviderId; platform: string; installRoot: string }[] = []
  /** Every install call, in order. */
  readonly installs: { providerId: DebugProviderId; platform: string; installRoot: string }[] = []
  private installed: boolean

  constructor(ctx: Context, private readonly resolved: ResolvedDebugAdapter, options: { preinstalled: boolean }) {
    super(ctx)
    this.installed = options.preinstalled
  }

  override async resolve(providerId: DebugProviderId, call: DebugAdapterResolveCall): Promise<ResolvedDebugAdapter> {
    this.resolves.push({ providerId, platform: call.platform, installRoot: call.installRoot })
    if (!this.installed) {
      throw new DebugError(`adapter "${providerId}" is not installed`, 'DEBUG_ADAPTER_NOT_FOUND')
    }
    return this.resolved
  }

  override async install(
    providerId: DebugProviderId,
    call: DebugAdapterInstallCall,
  ): Promise<{ directory: string; archiveFile: string; executableFile: string }> {
    this.installs.push({ providerId, platform: call.platform, installRoot: call.installRoot })
    this.installed = true
    return {
      directory: '/adapters/node/1.0.0',
      archiveFile: '/adapters/node/1.0.0/adapter.tgz',
      executableFile: '/adapters/node/1.0.0/adapter',
    }
  }
}

/** Everything one host test mounts, with the doubles wired in. */
interface Harness {
  readonly ctx: Context
  readonly manager: HarnessAdapterManager
  readonly subprocess: HarnessSubprocess
  readonly caller: Session
  readonly events: DebugEvent[]
}

/** The resolved adapter every successful manager call returns. */
function resolvedAdapter(): ResolvedDebugAdapter {
  return {
    command: ['node', 'js-debug/src/dapDebugServer.js'],
    args: [],
    env: {},
    version: '9.9.9',
    platform: `${process.platform}-${process.arch}`,
    source: 'managed',
    executablePath: '/adapters/node/js-debug/src/dapDebugServer.js',
  }
}

/** Mount the debug seam, the host, and the doubles on one fresh context. */
async function mount(options: { installRoot?: string; preinstalled?: boolean } = {}): Promise<Harness> {
  const ctx = new Context()
  roots.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(LocalFileSystem)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SandboxPolicyService, { mode: 'read-only', workspaceRoot: '/ws', additionalWritableRoots: [] })
  await ctx.plugin(Debug)
  const manager = new HarnessAdapterManager(ctx, resolvedAdapter(), { preinstalled: options.preinstalled === true })
  const subprocess = new HarnessSubprocess()
  ctx.provide('subprocess', subprocess)
  const caller = ctx.sessions.create(SessionId('host-caller'))
  const events: DebugEvent[] = []
  ctx.debug.events.subscribe({}, event => events.push(event))
  await ctx.plugin(DebugHost, {
    installRoot: options.installRoot ?? '/adapters/root',
    requestTimeoutMs: 5_000,
    resumeTimeoutMs: 5_000,
    consoleLimit: 200,
  })
  return { ctx, manager, subprocess, caller, events }
}

/** The fixture provider's id, whose registration each launch targets. */
const PROVIDER_ID = fixtureProvider('node', async () => fixtureLaunchPlan()).id

/** One minimal launch request against the fixture provider. */
function launchRequest(): Parameters<DebugHost['launch']>[0] {
  return {
    providerId: PROVIDER_ID,
    workspaceRoot: '/ws',
    workspaceId: 'ws',
    cwd: '/ws',
    program: 'src/a.ts',
    stopOnEntry: true,
    caller: { kind: 'user', sessionId: SessionId('host-caller') },
  }
}

/** The caller session's durable debug events, oldest first. */
function durableEventsOf(session: Session): { type: string; data: Record<string, unknown> }[] {
  return session.snapshotEvents()
    .filter(event => event.type.startsWith('debug/'))
    .map(event => ({ type: event.type, data: event.data as Record<string, unknown> }))
}

describe('debug host', () => {
  it('launches through plan, spawn, handshake, registry, backend registration, and durable events', async () => {
    const harness = await mount({ preinstalled: true })
    const provider = fixtureProvider('node', async () => fixtureLaunchPlan({ command: ['adapter'] }))
    harness.ctx.debug.registerProvider(provider)
    const session = await harness.ctx.debug.launch(launchRequest())
    const scripted = harness.subprocess.adapters[0]
    expect(scripted).toBeDefined()
    expect(scripted?.commands).toEqual(['initialize', 'configurationDone', 'launch', 'stackTrace', 'stackTrace'])
    expect(harness.subprocess.spawns[0]?.argv).toEqual(['adapter'])
    expect(session.state).toBe('stopped')
    expect(harness.ctx.debug.backendOf(session.id)).toBeDefined()
    const durable = durableEventsOf(harness.caller)
    expect(durable.map(event => event.type)).toEqual(['debug/session-started', 'debug/stopped'])
    expect(durable[0]?.data).toMatchObject({
      sessionId: String(session.id),
      providerId: 'node',
      language: 'node',
      mode: 'launch',
      workspaceRoot: '/ws',
      adapterVersion: '9.9.9',
    })
    expect(durable[1]?.data).toMatchObject({
      sessionId: String(session.id),
      reason: 'breakpoint',
      threadId: '1',
      source: 'src/a.ts',
      line: 4,
    })
    expect(provider.resolveLaunch).toHaveBeenCalledWith(launchRequest(), expect.anything())
  })

  it('publishes the handshake capabilities under the committed session id', async () => {
    const harness = await mount({ preinstalled: true })
    harness.ctx.debug.registerProvider(fixtureProvider('node', async () => fixtureLaunchPlan({ command: ['adapter'] })))
    const session = await harness.ctx.debug.launch(launchRequest())
    const capabilityEvents = harness.events.filter(event => event.kind === 'capabilities/changed')
    expect(capabilityEvents).toHaveLength(1)
    expect(capabilityEvents[0]).toMatchObject({
      kind: 'capabilities/changed',
      sessionId: session.id,
      workspaceId: 'ws',
    })
  })

  it('installs the managed adapter on miss and resolves with the configured root and platform', async () => {
    const harness = await mount({ installRoot: '/custom/adapters', preinstalled: false })
    harness.ctx.debug.registerProvider(fixtureProvider('node', async () => fixtureLaunchPlan({ command: ['adapter'] })))
    const session = await harness.ctx.debug.launch(launchRequest())
    expect(session.state).toBe('stopped')
    expect(harness.manager.resolves).toHaveLength(2)
    expect(harness.manager.resolves[0]).toMatchObject({ platform: `${process.platform}-${process.arch}`, installRoot: '/custom/adapters' })
    expect(harness.manager.installs).toEqual([
      { providerId: PROVIDER_ID, platform: `${process.platform}-${process.arch}`, installRoot: '/custom/adapters' },
    ])
  })

  it('attaches through the same composition and records the attach mode', async () => {
    const harness = await mount({ preinstalled: true })
    const provider = {
      ...fixtureProvider('node', async () => fixtureLaunchPlan({ command: ['adapter'] })),
      resolveAttach: vi.fn(async () => fixtureAttachPlan({ command: ['adapter'] })),
    }
    harness.ctx.debug.registerProvider(provider)
    const session = await harness.ctx.debug.attach({
      providerId: provider.id,
      workspaceRoot: '/ws',
      workspaceId: 'ws',
      port: 9229,
      caller: { kind: 'agent', sessionId: SessionId('host-caller') },
    })
    const scripted = harness.subprocess.adapters[0]
    expect(scripted?.commands).toContain('attach')
    expect(session.state).toBe('stopped')
    const started = durableEventsOf(harness.caller).find(event => event.type === 'debug/session-started')
    expect(started?.data).toMatchObject({ mode: 'attach', providerId: 'node' })
  })

  it('fails typed before any spawn when the caller session is not live', async () => {
    const harness = await mount({ preinstalled: true })
    harness.ctx.debug.registerProvider(fixtureProvider('node', async () => fixtureLaunchPlan({ command: ['adapter'] })))
    const request = { ...launchRequest(), caller: { kind: 'user' as const, sessionId: SessionId('missing-caller') } }
    await expect(harness.ctx.debug.launch(request)).rejects.toMatchObject({ code: 'DEBUG_SESSION_GONE' })
    expect(harness.subprocess.spawns).toHaveLength(0)
  })

  it('fails typed for an unregistered provider without touching the adapter manager', async () => {
    const harness = await mount({ preinstalled: true })
    const request = { ...launchRequest(), providerId: fixtureProvider('ghost', async () => fixtureLaunchPlan()).id }
    await expect(harness.ctx.debug.launch(request)).rejects.toMatchObject({ code: 'DEBUG_ADAPTER_NOT_FOUND' })
    expect(harness.manager.resolves).toHaveLength(0)
  })

  it('records the failed end event on the caller session when the provider plan fails', async () => {
    const harness = await mount({ preinstalled: true })
    harness.ctx.debug.registerProvider(fixtureProvider('node', async () => { throw new Error('plan exploded') }))
    await expect(harness.ctx.debug.launch(launchRequest())).rejects.toMatchObject({ code: 'DEBUG_LAUNCH_FAILED' })
    const durable = durableEventsOf(harness.caller)
    expect(durable.map(event => event.type)).toEqual(['debug/session-ended'])
    expect(durable[0]?.data).toMatchObject({ outcome: 'failed' })
    expect(typeof durable[0]?.data['durationMs']).toBe('number')
    expect(typeof durable[0]?.data['reason']).toBe('string')
  })
})
