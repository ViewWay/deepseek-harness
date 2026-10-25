/**
 * The `debug` family of the Workspace registry's archive admission: the
 * debug sessions a Session owns that are still live, and their termination
 * when the Session is archived with its work.
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { fixtureDebugSessionId, fixtureSessionId } from '@deepseek-ai/dsh-debug-fixture'
import { DebugSessionRegistry } from '../src/registry.ts'
import { installDebugArchiveAdmission } from '../src/archive-admission.ts'
import { sessionRecord } from './helpers/records.ts'

describe('debug archive admission', () => {
  it('reports the live sessions the asked Session owns and nothing else', async () => {
    const ctx = new Context()
    const registry = new DebugSessionRegistry()
    const owner = fixtureSessionId(7)
    registry.add(sessionRecord({ id: fixtureDebugSessionId(1), workspaceId: 'ws-1', ownerSessionId: owner }))
    registry.add(sessionRecord({ id: fixtureDebugSessionId(2), workspaceId: 'ws-1', ownerSessionId: fixtureSessionId(8) }))
    registry.add(sessionRecord({ id: fixtureDebugSessionId(3), workspaceId: 'ws-1', state: 'terminated' }))
    installDebugArchiveAdmission(ctx, registry)

    const activity = await ctx.waterfall('workspace/session-activity', { sessionId: owner }, () => Promise.resolve([]))
    expect(activity).toEqual([{ kind: 'debug', items: [{ id: fixtureDebugSessionId(1) }] }])
  })

  it('terminates each owned session once when the Session is archived', async () => {
    const ctx = new Context()
    const registry = new DebugSessionRegistry()
    const owner = fixtureSessionId(7)
    const first = sessionRecord({ id: fixtureDebugSessionId(1), workspaceId: 'ws-1', ownerSessionId: owner })
    const second = sessionRecord({ id: fixtureDebugSessionId(2), workspaceId: 'ws-1', ownerSessionId: owner })
    registry.add(first)
    registry.add(second)
    const removed: string[] = []
    const removeSpy = vi.spyOn(registry, 'remove').mockImplementation(async (id: fixtureDebugSessionIdType) => {
      removed.push(id)
    })
    installDebugArchiveAdmission(ctx, registry)

    await ctx.parallel('workspace/session-stop', { sessionId: owner })
    expect(removed.sort()).toEqual([fixtureDebugSessionId(1), fixtureDebugSessionId(2)].sort())
    removeSpy.mockRestore()
  })
})

type fixtureDebugSessionIdType = ReturnType<typeof fixtureDebugSessionId>
