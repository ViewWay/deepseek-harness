/**
 * SDK debug-event projection: the four durable `debug/*` session events a
 * runtime emits survive the stdio wire as typed, ignorable envelopes with
 * their bounded session-log fields, paired with the Python SDK's identical
 * expected output.
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { fixtureDebugSessionId } from '@deepseek-ai/dsh-debug-fixture'
import { createProcessDeepSeekHarness } from '../src/api.ts'

const expectedPath = fileURLToPath(new URL('./expected/debug-events.json', import.meta.url))
const fakeRuntime = fileURLToPath(new URL('./fake-runtime.ts', import.meta.url))

function isDebugEvent(value: unknown): value is { type: `debug/${string}` } {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && 'type' in value && typeof value.type === 'string' && value.type.startsWith('debug/')
}

it('projects the four durable debug events through the SDK wire with their ignorable envelopes', async () => {
  const expected = JSON.parse(await readFile(expectedPath, 'utf8')) as {
    finalResponse: string
    debugEvents: Record<string, unknown>[]
    debugNotifications: { method: string; event: Record<string, unknown> }[]
    assistantTexts: string[]
  }
  const sessionId = fixtureDebugSessionId(1)
  // The four durable events are inlined: dsh-debug's typed factories live in
  // its test helpers rather than its package entry, and the fake runtime below
  // overwrites `seq`/`time` on every scripted event anyway.
  const debugEvents = [
    {
      type: 'debug/session-started',
      ignorable: true,
      data: { sessionId, providerId: 'node', language: 'node', mode: 'launch', workspaceRoot: '/ws', adapterVersion: '1.140.0' },
    },
    {
      type: 'debug/stopped',
      ignorable: true,
      data: { sessionId, reason: 'breakpoint', threadId: 'thread-1', source: 'src/a.ts', line: 4, column: 2 },
    },
    {
      type: 'debug/control',
      ignorable: true,
      data: { sessionId, actor: 'user', operation: 'continue', threadId: 'thread-1' },
    },
    {
      type: 'debug/session-ended',
      ignorable: true,
      data: { sessionId, outcome: 'terminated', reason: 'completed', durationMs: 5000 },
    },
  ]
  const harness = createProcessDeepSeekHarness({
    command: process.execPath, args: [fakeRuntime],
    environment: () => ({ ...process.env, FAKE_TEXT: expected.finalResponse, FAKE_SESSION_EVENTS: JSON.stringify(debugEvents) }),
    description: 'scripted SDK debug projection', initializeTimeoutMs: 5000,
  })
  try {
    const result = await harness.run('Start the debug scenario.')
    const projection = {
      finalResponse: result.finalResponse,
      debugEvents: result.events.filter(isDebugEvent),
      debugNotifications: result.notifications.filter(notification => notification.method === 'session.event'
        && isDebugEvent(notification.params.event)).map((notification) => {
        if (notification.method !== 'session.event') throw new Error('Expected a Session event notification')
        expect(notification.params.sessionId).toBe(result.sessionId)
        return { method: notification.method, event: notification.params.event }
      }),
      assistantTexts: result.events.filter(event => event.type === 'assistant/message')
        .flatMap(event => event.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : [])),
    }
    expect(projection).toEqual(expected)
    expect(projection.debugEvents.map(event => event.type)).toEqual([
      'debug/session-started', 'debug/stopped', 'debug/control', 'debug/session-ended',
    ])
    for (const event of projection.debugEvents) {
      expect(event).toMatchObject({ ignorable: true })
      expect(event).not.toHaveProperty('surfaceOp')
      expect(event).not.toHaveProperty('sourceEventSeqs')
    }
  } finally {
    await harness.close()
  }
})
