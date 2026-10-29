/**
 * Minimal headless projection harness for debug event tests: a real context
 * and session store driving the same NDJSON projection the json-stream tests
 * use, with a typed emitter for the durable debug event payloads.
 */

import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { unsupportedInbox } from '@deepseek-ai/dsh-agent-loop-testkit/src/inbox.ts'
import { unsupportedModel } from '@deepseek-ai/dsh-agent-loop-testkit/src/model.ts'
import SessionStore from '@deepseek-ai/dsh-session'
import type { SessionEventMap, SessionEventType } from '@deepseek-ai/dsh-session/types'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { projectJsonRun } from '../src/json-stream.ts'

interface DebugHarness {
  readonly lines: string[]
  readonly parsed: () => Record<string, unknown>[]
  emit<K extends SessionEventType>(type: K, data: SessionEventMap[K]): void
}

/**
 * Build one structural agent stub over the given session. The headless
 * projection reads only the identity and the session; the loop-facing members
 * exist to satisfy the interface and are never invoked by the harness.
 * @param session - the store-created session the agent owns.
 * @param ctx - the harness context the stub carries.
 * @returns the agent driving the projection.
 */
function harnessAgent(session: Agent['session'], ctx: Context): Agent {
  /* v8 ignore next 9 -- loop-facing stub members the NDJSON projection never calls. */
  return {
    id: SessionId('session-1'),
    options: {},
    session,
    model: unsupportedModel(),
    inbox: unsupportedInbox(),
    status: 'idle',
    ctx,
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject: () => {},
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
}

/**
 * Build one headless projection harness over a real session store.
 * @returns the harness with its sink and typed emit helper.
 */
export async function createHeadlessHarness(): Promise<DebugHarness> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  const session = ctx.sessions.create(SessionId('session-1'))
  const lines: string[] = []
  projectJsonRun(ctx, harnessAgent(session, ctx), {
    write: (chunk: string) => { lines.push(chunk); return true },
  })
  return {
    lines,
    parsed: () => lines.map(line => JSON.parse(line) as Record<string, unknown>),
    emit: (type, data) => {
      session.append(type, data)
    },
  }
}
