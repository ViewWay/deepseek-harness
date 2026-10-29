/**
 * The `debug` family of the Workspace registry's archive admission: the
 * debug sessions a Session owns that are still live, and their termination
 * when the Session archives with its work. Both listeners live as long as
 * the calling fiber.
 * @module @deepseek-ai/dsh-debug/archive-admission
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionActivity } from '@deepseek-ai/dsh-workspace'
import type { DebugSessionId } from './brand.ts'
import type { DebugSessionRegistry } from './registry.ts'

declare module '@deepseek-ai/dsh-workspace' {
  interface SessionActivityKindMap {
    /** A debug session owned by this session is still live. */
    debug: true
  }
}

/** The registry's sessions the owner still holds live. */
function liveSessions(registry: DebugSessionRegistry, owner: SessionId): readonly { readonly id: DebugSessionId }[] {
  return registry.list({ ownerSessionId: owner })
    .filter(record => record.state === 'starting' || record.state === 'running' || record.state === 'stopped')
    .map(record => ({ id: record.id }))
}

/**
 * Answer `workspace/session-activity` with the live debug sessions the asked
 * Session owns, and `workspace/session-stop` by terminating each of them.
 * @param ctx - the owning fiber's context.
 * @param registry - the session registry that answers.
 */
export function installDebugArchiveAdmission(ctx: Context, registry: DebugSessionRegistry): void {
  ctx.on('workspace/session-activity', async ({ sessionId }, next) => {
    const sessions = liveSessions(registry, sessionId)
    const rest = await next()
    if (sessions.length === 0) return rest
    const own: SessionActivity = { kind: 'debug', items: sessions.map(session => ({ id: session.id })) }
    return [own, ...rest]
  })
  ctx.on('workspace/session-stop', async ({ sessionId }) => {
    for (const session of liveSessions(registry, sessionId)) {
      try {
        await registry.remove(session.id, 'user')
      } catch (error: unknown) {
        // One session failing to stop must not keep the Session's other debug sessions running once it is archived.
        ctx.logger.warn(`debug: terminating "${session.id}" for an archived Session failed: ${String(error)}`)
      }
    }
  })
}
