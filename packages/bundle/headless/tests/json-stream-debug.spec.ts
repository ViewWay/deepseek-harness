/**
 * Headless debug NDJSON: the four durable debug events project as bounded
 * JSON lines with their session-log fields, never raw DAP or variables.
 */

import { describe, expect, it } from 'vitest'
import { createHeadlessHarness } from './headless-debug-harness.ts'

describe('headless debug NDJSON', () => {
  it('emits a bounded stop event without variables or raw DAP', async () => {
    const harness = await createHeadlessHarness()
    harness.emit('debug/stopped', {
      sessionId: 'debug-1', reason: 'breakpoint', threadId: 'thread-1',
      source: 'src/a.ts', line: 4, column: 2,
    })
    const line = harness.parsed().at(-1)
    expect(line).toMatchObject({
      type: 'debug/stopped',
      data: { sessionId: 'debug-1', reason: 'breakpoint', source: 'src/a.ts', line: 4 },
    })
    expect(JSON.stringify(line)).not.toContain('variables')
    expect(JSON.stringify(line)).not.toContain('Content-Length')
  })

  it('emits session-started, session-ended, and control events with their bounded fields', async () => {
    const harness = await createHeadlessHarness()
    harness.emit('debug/session-started', {
      sessionId: 'debug-1', providerId: 'node', language: 'node', mode: 'launch',
      workspaceRoot: '/ws', adapterVersion: '1.140.0',
    })
    harness.emit('debug/session-ended', {
      sessionId: 'debug-1', outcome: 'terminated', reason: 'completed', durationMs: 5000,
    })
    harness.emit('debug/control', {
      sessionId: 'debug-1', actor: 'agent', operation: 'continue', threadId: 'thread-1',
    })
    const lines = harness.parsed().slice(1)
    expect(lines[0]).toMatchObject({
      type: 'debug/session-started',
      data: { sessionId: 'debug-1', providerId: 'node', mode: 'launch' },
    })
    expect(lines[1]).toMatchObject({
      type: 'debug/session-ended',
      data: { sessionId: 'debug-1', outcome: 'terminated' },
    })
    expect(lines[2]).toMatchObject({
      type: 'debug/control',
      data: { sessionId: 'debug-1', actor: 'agent', operation: 'continue' },
    })
    for (const line of lines) {
      expect(JSON.stringify(line)).not.toContain('env')
      expect(JSON.stringify(line)).not.toContain('memory')
    }
  })

  it('bounds long strings in debug events with the existing cap', async () => {
    const harness = await createHeadlessHarness()
    harness.emit('debug/stopped', {
      sessionId: 'debug-1', reason: 'breakpoint', threadId: 'thread-1',
      source: 'src/'.repeat(2000) + 'a.ts', line: 4, column: 2,
    })
    const raw = harness.lines.at(-1) ?? ''
    expect(raw.length).toBeLessThan(10 * 1024)
  })
})
