/**
 * TUI session: submits prompts through the existing session path and records
 * user entries in the transcript.
 */

import { describe, expect, it, vi } from 'vitest'
import { createTuiSession } from '../src/session.ts'

describe('TUI session', () => {
  it('submits a prompt through the existing session path and records the user entry', async () => {
    const send = vi.fn(async () => {})
    const session = createTuiSession({ send, sessionId: 'session-1' })
    await session.submit('hello')
    expect(send).toHaveBeenCalledWith('hello')
    expect(session.transcript().entries[0]).toMatchObject({ kind: 'user', text: 'hello' })
  })

  it('records assistant entries without a second send', async () => {
    const send = vi.fn(async () => {})
    const session = createTuiSession({ send, sessionId: 'session-1' })
    session.receive({ kind: 'assistant', text: 'Done.' })
    expect(send).not.toHaveBeenCalled()
    expect(session.transcript().entries).toHaveLength(1)
    expect(session.transcript().entries[0]).toMatchObject({ kind: 'assistant', text: 'Done.' })
  })

  it('notifies subscribers on transcript changes and stops on unsubscribe', async () => {
    const send = vi.fn(async () => {})
    const session = createTuiSession({ send, sessionId: 'session-1' })
    const seen: number[] = []
    const stop = session.subscribe((transcript) => { seen.push(transcript.entries.length) })
    await session.submit('hello')
    session.receive({ kind: 'assistant', text: 'Done.' })
    stop()
    session.receive({ kind: 'assistant', text: 'Later.' })
    expect(seen).toEqual([1, 2])
    expect(session.transcript().entries).toHaveLength(3)
  })

  it('receives a truncated tool output, stores it behind an expand id, and opens it on :expand', () => {
    const send = vi.fn(async () => {})
    const session = createTuiSession({ send, sessionId: 'session-1' })
    session.receive({ kind: 'tool', name: 'debug_execution', summary: 'stopped…', fullText: 'stopped at src/a.ts:4' })
    expect(session.transcript().entries[0]).toMatchObject({ expandId: 1 })
    expect(session.transcript().stored.get(1)).toBe('stopped at src/a.ts:4')
    const seen: number[] = []
    session.subscribe(() => { seen.push(session.transcript().entries.length) })
    const result = session.expand(['1'])
    expect(result.ok).toBe(true)
    expect(session.transcript().entries[0]).toMatchObject({ expandId: 1, expanded: true })
    expect(seen).toEqual([1])
  })

  it('returns the expand error without changing the transcript or notifying', () => {
    const send = vi.fn(async () => {})
    const session = createTuiSession({ send, sessionId: 'session-1' })
    const before = session.transcript()
    const seen: number[] = []
    session.subscribe(() => { seen.push(1) })
    const result = session.expand(['9'])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('no stored output 9')
    expect(session.transcript()).toBe(before)
    expect(seen).toEqual([])
  })
})
