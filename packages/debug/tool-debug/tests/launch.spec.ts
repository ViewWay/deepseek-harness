/**
 * The approval-gated launch/attach dispatch: fail-closed agent approval,
 * control authorization of the session the caller will own, delegation to the
 * orchestrator seam, the durable `debug/control` audit append, and the typed
 * `DEBUG_UNAVAILABLE` of a composition without an orchestrator (through the
 * real debug service).
 */

/* oxlint-disable typescript/no-unsafe-assignment -- Vitest asymmetric matchers are typed as any. */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { Debug, DebugProviderId } from '@deepseek-ai/dsh-debug'
import type { DebugSessionInfo } from '@deepseek-ai/dsh-debug'
import { fixtureDebugSessionId, fixtureSessionId } from '@deepseek-ai/dsh-debug-fixture'
import { approvalFaceOf, authorizeWriteMemory, dispatchSessionLaunch } from '../src/launch.ts'
import type { DebugLaunchDeps } from '../src/launch.ts'
import type { DebugApprovalFace } from '../src/approval.ts'

/** One approval face double resolving the given outcome. */
function approvalDouble(outcome: 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable') {
  return { request: vi.fn(async () => outcome) }
}

/** The registered session every debug service double resolves. */
const INFO: DebugSessionInfo = {
  id: fixtureDebugSessionId(7),
  providerId: DebugProviderId('node'),
  workspaceId: 'ws-1',
  state: 'stopped',
  ownerSessionId: fixtureSessionId(3),
}

/** One debug service double recording every launch and attach request. */
function debugDouble() {
  return {
    launch: vi.fn(async (_request: object) => ({ info: INFO })),
    attach: vi.fn(async (_request: object) => ({ info: INFO })),
  }
}

/** Mount the real debug service with its projection registry dependency. */
async function mountDebug(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(Debug)
  return ctx
}

describe('debug session launch dispatch', () => {
  it('denies an agent launch without an approval grant before any delegation', async () => {
    const approval = approvalDouble('rejected')
    const debug = debugDouble()
    const appendControl = vi.fn()
    await expect(dispatchSessionLaunch({
      debug, approval, appendControl, caller: { kind: 'agent', sessionId: fixtureSessionId(3) }, agent: {},
    }, 'launch', {
      providerId: 'node', workspaceId: 'ws-1', workspaceRoot: '/ws', cwd: '/ws',
    })).rejects.toMatchObject({ code: 'DEBUG_APPROVAL_DENIED' })
    expect(debug.launch).not.toHaveBeenCalled()
    expect(appendControl).not.toHaveBeenCalled()
  })

  it('fails closed when no approval answerer is composed', async () => {
    const debug = debugDouble()
    await expect(dispatchSessionLaunch({
      debug,
      approval: approvalFaceOf(undefined),
      appendControl: vi.fn(),
      caller: { kind: 'agent', sessionId: fixtureSessionId(3) },
      agent: {},
    }, 'launch', {
      providerId: 'node', workspaceId: 'ws-1', workspaceRoot: '/ws', cwd: '/ws',
    })).rejects.toMatchObject({ code: 'DEBUG_APPROVAL_DENIED' })
    expect(debug.launch).not.toHaveBeenCalled()
  })

  it('delegates an approved agent launch and appends the control audit', async () => {
    const approval = approvalDouble('allowed-once')
    const debug = debugDouble()
    const appendControl = vi.fn()
    const outcome = await dispatchSessionLaunch({
      debug, approval, appendControl, caller: { kind: 'agent', sessionId: fixtureSessionId(3) }, agent: {},
    }, 'launch', {
      providerId: 'node',
      workspaceId: 'ws-1',
      workspaceRoot: '/ws',
      cwd: '/ws',
      program: 'src/a.ts',
      args: ['--flag'],
      env: { NODE_ENV: 'test', COUNT: 3 },
      stopOnEntry: true,
    })
    expect(approval.request).toHaveBeenCalledWith(expect.objectContaining({
      toolName: 'debug_session',
      reason: expect.stringContaining('launch'),
    }))
    expect(debug.launch).toHaveBeenCalledWith(expect.objectContaining({
      providerId: DebugProviderId('node'),
      workspaceRoot: '/ws',
      workspaceId: 'ws-1',
      cwd: '/ws',
      program: 'src/a.ts',
      args: ['--flag'],
      env: { NODE_ENV: 'test', COUNT: '3' },
      stopOnEntry: true,
      caller: { kind: 'agent', sessionId: fixtureSessionId(3) },
    }))
    expect(appendControl).toHaveBeenCalledWith({
      sessionId: INFO.id,
      actor: 'agent',
      operation: 'launch',
    })
    expect(outcome.info).toBe(INFO)
    expect(outcome.grant).toMatchObject({ source: 'owned' })
  })

  it('attaches with the target fields and no cwd requirement', async () => {
    const approval = approvalDouble('allowed-once')
    const debug = debugDouble()
    const appendControl = vi.fn()
    await dispatchSessionLaunch({
      debug, approval, appendControl, caller: { kind: 'agent', sessionId: fixtureSessionId(3) }, agent: {},
    }, 'attach', {
      providerId: 'node', workspaceId: 'ws-1', workspaceRoot: '/ws', processId: 4242, port: 9229, url: 'http://localhost:9229',
    })
    expect(approval.request).toHaveBeenCalledWith(expect.objectContaining({
      toolName: 'debug_session',
      reason: expect.stringContaining('attach'),
    }))
    expect(debug.launch).not.toHaveBeenCalled()
    expect(debug.attach).toHaveBeenCalledWith(expect.objectContaining({
      providerId: DebugProviderId('node'),
      workspaceRoot: '/ws',
      workspaceId: 'ws-1',
      processId: 4242,
      port: 9229,
      url: 'http://localhost:9229',
      caller: { kind: 'agent', sessionId: fixtureSessionId(3) },
    }))
    expect(appendControl).toHaveBeenCalledWith({
      sessionId: INFO.id,
      actor: 'agent',
      operation: 'attach',
    })
  })

  it('lets a user caller bypass the approval seam and records their ownership', async () => {
    const approval = approvalDouble('rejected')
    const debug = debugDouble()
    const appendControl = vi.fn()
    const outcome = await dispatchSessionLaunch({
      debug, approval, appendControl, caller: { kind: 'user', sessionId: fixtureSessionId(3) },
    }, 'launch', {
      providerId: 'node', workspaceId: 'ws-1', workspaceRoot: '/ws', cwd: '/ws',
    })
    expect(approval.request).not.toHaveBeenCalled()
    expect(debug.launch).toHaveBeenCalledWith(expect.objectContaining({
      caller: { kind: 'user', sessionId: fixtureSessionId(3) },
    }))
    expect(appendControl).toHaveBeenCalledWith({
      sessionId: INFO.id,
      actor: 'user',
      operation: 'launch',
    })
    expect(outcome.grant).toMatchObject({ source: 'owned' })
  })

  it('validates the required fields before asking anything', async () => {
    const approval = approvalDouble('allowed-once')
    const debug = debugDouble()
    const deps: DebugLaunchDeps = {
      debug, approval, appendControl: vi.fn(), caller: { kind: 'agent', sessionId: fixtureSessionId(3) }, agent: {},
    }
    await expect(dispatchSessionLaunch(deps, 'launch', {
      workspaceId: 'ws-1', workspaceRoot: '/ws', cwd: '/ws',
    })).rejects.toMatchObject({ code: 'DEBUG_INVALID_CONFIG' })
    await expect(dispatchSessionLaunch(deps, 'launch', {
      providerId: 'node', workspaceRoot: '/ws', cwd: '/ws',
    })).rejects.toMatchObject({ code: 'DEBUG_INVALID_CONFIG' })
    await expect(dispatchSessionLaunch(deps, 'attach', {
      providerId: 'node', workspaceId: 'ws-1',
    })).rejects.toMatchObject({ code: 'DEBUG_INVALID_CONFIG' })
    await expect(dispatchSessionLaunch(deps, 'launch', {
      providerId: 'node', workspaceId: 'ws-1', workspaceRoot: '/ws',
    })).rejects.toMatchObject({ code: 'DEBUG_INVALID_CONFIG' })
    expect(approval.request).not.toHaveBeenCalled()
    expect(debug.launch).not.toHaveBeenCalled()
  })

  it('propagates the typed unavailability of a composition without an orchestrator', async () => {
    const ctx = await mountDebug()
    const appendControl = vi.fn()
    await expect(dispatchSessionLaunch({
      debug: ctx.debug,
      approval: approvalDouble('allowed-once'),
      appendControl,
      caller: { kind: 'agent', sessionId: fixtureSessionId(3) },
      agent: {},
    }, 'launch', {
      providerId: 'node', workspaceId: 'ws-1', workspaceRoot: '/ws', cwd: '/ws',
    })).rejects.toMatchObject({ code: 'DEBUG_UNAVAILABLE' })
    expect(appendControl).not.toHaveBeenCalled()
  })
})

describe('debug memory-write authorization', () => {
  it('denies an agent memory write without a grant', async () => {
    const approval: DebugApprovalFace = approvalDouble('unavailable')
    await expect(authorizeWriteMemory(approval, { kind: 'agent' }, {
      agent: {}, memoryReference: '0x1000',
    })).rejects.toMatchObject({ code: 'DEBUG_APPROVAL_DENIED' })
  })

  it('asks for every agent memory write with the audited reason', async () => {
    const approval = approvalDouble('allowed-once')
    await expect(authorizeWriteMemory(approval, { kind: 'agent' }, { agent: {}, memoryReference: '0x1000' }))
      .resolves.toBeUndefined()
    expect(approval.request).toHaveBeenCalledWith(expect.objectContaining({
      toolName: 'debug_inspect',
      reason: 'write memory at 0x1000',
    }))
  })

  it('lets a user caller bypass the memory-write approval seam', async () => {
    const approval = approvalDouble('rejected')
    await expect(authorizeWriteMemory(approval, { kind: 'user' }, {})).resolves.toBeUndefined()
    expect(approval.request).not.toHaveBeenCalled()
  })
})
