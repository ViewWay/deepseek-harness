/**
 * Minimal headless projection harness for debug event tests: the same fake
 * context and sink the json-stream tests use, with helpers for the four
 * durable debug event types.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { projectJsonRun } from '../src/json-stream.ts'

interface DebugHarness {
  readonly lines: string[]
  readonly parsed: () => Record<string, unknown>[]
  emit(event: SessionEvent): void
}

/**
 * Build one headless projection harness.
 * @returns the harness with its sink and emit helper.
 */
export function createHeadlessHarness(): DebugHarness {
  const listeners = new Set<(session: unknown, event: SessionEvent) => void>()
  const ctx = {
    on(name: string, handler: unknown) {
      if (name === 'session/event') listeners.add(handler as never)
      return () => { listeners.delete(handler as never) }
    },
  } as unknown as Context
  const session = {} as Session
  const agent = { id: 'session-1', session } as unknown as Agent
  const lines: string[] = []
  projectJsonRun(ctx, agent, {
    write: (chunk: string) => { lines.push(chunk); return true },
  })
  return {
    lines,
    parsed: () => lines.map(line => JSON.parse(line) as Record<string, unknown>),
    emit: (event: SessionEvent) => {
      for (const listener of listeners) listener(session, event)
    },
  }
}
