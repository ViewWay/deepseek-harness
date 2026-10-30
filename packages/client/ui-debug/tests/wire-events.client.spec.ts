/** The wire projection: ring payloads narrow onto fold events, and unpresentable payloads skip. */
import { describe, expect, it } from 'vitest'
import { debugViewEventOf } from '../src/client/wire-events.ts'

describe('debugViewEventOf', () => {
  it('rejects non-object payloads and objects without kind or sessionId', () => {
    expect(debugViewEventOf(1, 'session/running')).toBeUndefined()
    expect(debugViewEventOf(1, ['session/running'])).toBeUndefined()
    expect(debugViewEventOf(1, null)).toBeUndefined()
    expect(debugViewEventOf(1, { sessionId: 'debug-1' })).toBeUndefined()
    expect(debugViewEventOf(1, { kind: 'session/running' })).toBeUndefined()
  })

  it('maps the domain lifecycle kinds onto session states and termination', () => {
    expect(debugViewEventOf(1, { kind: 'session/starting', sessionId: 'debug-1', workspaceId: 'ws' }))
      .toEqual({ kind: 'session/state', sessionId: 'debug-1', state: 'starting' })
    expect(debugViewEventOf(2, { kind: 'session/running', sessionId: 'debug-1', workspaceId: 'ws' }))
      .toEqual({ kind: 'session/state', sessionId: 'debug-1', state: 'running' })
    expect(debugViewEventOf(3, { kind: 'session/failed', sessionId: 'debug-1', workspaceId: 'ws' }))
      .toEqual({ kind: 'session/state', sessionId: 'debug-1', state: 'failed' })
    expect(debugViewEventOf(4, { kind: 'session/terminated', sessionId: 'debug-1', workspaceId: 'ws', actor: 'user' }))
      .toEqual({ kind: 'session/terminated', sessionId: 'debug-1' })
  })

  it('folds a stopped payload only with a known reason and complete numeric fields', () => {
    const base = { kind: 'session/stopped', sessionId: 'debug-1', workspaceId: 'ws' } as const
    expect(debugViewEventOf(1, { ...base, reason: 'reboot', threadId: 1, source: 'src/a.ts', line: 1, column: 1 }))
      .toEqual({ kind: 'session/state', sessionId: 'debug-1', state: 'stopped' })
    expect(debugViewEventOf(2, { ...base, reason: 'pause', threadId: 'main', source: 'src/a.ts', line: 1, column: 1 }))
      .toEqual({ kind: 'session/state', sessionId: 'debug-1', state: 'stopped' })
    expect(debugViewEventOf(3, { ...base, reason: 'pause', threadId: 2, source: 'src/a.ts', line: 1.5, column: 1 }))
      .toEqual({ kind: 'session/state', sessionId: 'debug-1', state: 'stopped' })
    expect(debugViewEventOf(6, { ...base, reason: 'pause', threadId: '', source: 'src/a.ts', line: 1, column: 1 }))
      .toEqual({ kind: 'session/state', sessionId: 'debug-1', state: 'stopped' })
    expect(debugViewEventOf(4, { ...base, reason: 'pause', threadId: 2, source: 7, line: 1, column: 1 }))
      .toEqual({ kind: 'session/state', sessionId: 'debug-1', state: 'stopped' })
    expect(debugViewEventOf(5, {
      kind: 'session/stopped', sessionId: 'debug-1', workspaceId: 'ws',
      reason: 'entry', threadId: 2, source: 'src/a.ts', line: 9, column: 3, description: 'entry stop',
    })).toEqual({
      kind: 'session/stopped',
      stop: { sessionId: 'debug-1', reason: 'entry', threadId: 2, source: 'src/a.ts', line: 9, column: 3, description: 'entry stop' },
    })
  })

  it('carries the record sequence and truncation flag on console output', () => {
    expect(debugViewEventOf(7, { kind: 'console/output', sessionId: 'debug-1', workspaceId: 'ws', truncated: 'yes', text: 'out' }))
      .toEqual({ kind: 'console/output', sessionId: 'debug-1', seq: 7, text: 'out', truncated: false })
    expect(debugViewEventOf(8, { kind: 'console/output', sessionId: 'debug-1', workspaceId: 'ws', truncated: true, text: 'cut' }))
      .toEqual({ kind: 'console/output', sessionId: 'debug-1', seq: 8, text: 'cut', truncated: true })
    expect(debugViewEventOf(9, { kind: 'console/output', sessionId: 'debug-1', workspaceId: 'ws', truncated: true }))
      .toBeUndefined()
  })

  it('decodes capabilities with absent fields reading false and rejects non-objects', () => {
    const event = debugViewEventOf(1, { kind: 'capabilities/changed', sessionId: 'debug-1', workspaceId: 'ws', capabilities: { supportsStepBack: true } })
    if (event?.kind !== 'capabilities/changed') throw new Error('expected a capabilities/changed fold event')
    expect(event.sessionId).toBe('debug-1')
    expect(event.capabilities.supportsStepBack).toBe(true)
    expect(event.capabilities.supportsTerminateRequest).toBe(false)
    expect(debugViewEventOf(2, { kind: 'capabilities/changed', sessionId: 'debug-1', workspaceId: 'ws' }))
      .toBeUndefined()
    expect(debugViewEventOf(3, { kind: 'capabilities/changed', sessionId: 'debug-1', workspaceId: 'ws', capabilities: 'yes' }))
      .toBeUndefined()
  })

  it('skips kinds the view vocabulary cannot present', () => {
    expect(debugViewEventOf(1, { kind: 'breakpoint/changed', sessionId: 'debug-1', workspaceId: 'ws', result: {} }))
      .toBeUndefined()
    expect(debugViewEventOf(2, { kind: 'adapter/output', sessionId: 'debug-1', workspaceId: 'ws', text: 'log', truncated: false }))
      .toBeUndefined()
    expect(debugViewEventOf(3, { kind: 'session/owner-changed', sessionId: 'debug-1', workspaceId: 'ws', from: {}, to: {} }))
      .toBeUndefined()
    expect(debugViewEventOf(4, { kind: 'session/hovered', sessionId: 'debug-1', workspaceId: 'ws' }))
      .toBeUndefined()
  })
})
