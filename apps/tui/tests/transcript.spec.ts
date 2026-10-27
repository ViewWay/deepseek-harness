/**
 * TUI transcript: ordered user, assistant, and bounded tool entries; long tool
 * outputs stay stored behind an expand id that `:expand <n>` opens.
 */

import { describe, expect, it } from 'vitest'
import { appendTranscript, createTranscript, expandTranscript } from '../src/transcript.ts'

describe('TUI transcript', () => {
  it('keeps user, assistant, and bounded tool summaries in order', () => {
    let state = createTranscript()
    state = appendTranscript(state, { kind: 'user', text: 'why does it fail?' })
    state = appendTranscript(state, { kind: 'assistant', text: 'Let me inspect.' })
    state = appendTranscript(state, { kind: 'tool', name: 'debug_execution', summary: 'stopped at src/a.ts:4' })
    expect(state.entries.map(entry => entry.kind)).toEqual(['user', 'assistant', 'tool'])
    expect(state.entries[2]).toMatchObject({ name: 'debug_execution', summary: 'stopped at src/a.ts:4' })
  })

  it('caps the retained entry count', () => {
    let state = createTranscript({ maxEntries: 3 })
    for (let index = 0; index < 5; index += 1) {
      state = appendTranscript(state, { kind: 'user', text: `message ${index}` })
    }
    expect(state.entries).toHaveLength(3)
    expect(state.entries[0]).toMatchObject({ text: 'message 2' })
  })

  it('stores a truncated tool output behind a sequential expand id', () => {
    let state = createTranscript()
    state = appendTranscript(state, {
      kind: 'tool',
      name: 'debug_execution',
      summary: 'stopped at src/a.ts:4…',
      fullText: 'stopped at src/a.ts:4\nframe 0',
    })
    state = appendTranscript(state, { kind: 'tool', name: 'debug_eval', summary: 'value…', fullText: 'the full value' })
    expect(state.entries[0]).toEqual({ kind: 'tool', name: 'debug_execution', summary: 'stopped at src/a.ts:4…', expandId: 1 })
    expect(state.entries[1]).toEqual({ kind: 'tool', name: 'debug_eval', summary: 'value…', expandId: 2 })
    expect(state.stored.get(1)).toBe('stopped at src/a.ts:4\nframe 0')
    expect(state.stored.get(2)).toBe('the full value')
  })

  it('opens the stored output for :expand <n> and only that entry', () => {
    let state = createTranscript()
    state = appendTranscript(state, { kind: 'assistant', text: 'Let me inspect.' })
    state = appendTranscript(state, {
      kind: 'tool',
      name: 'debug_execution',
      summary: 'stopped…',
      fullText: 'stopped at src/a.ts:4\nframe 0',
    })
    const result = expandTranscript(state, ['1'])
    if (!result.ok) throw new Error(`expected ok, got ${result.message}`)
    expect(result.transcript.entries[0]).toEqual({ kind: 'assistant', text: 'Let me inspect.' })
    expect(result.transcript.entries[1]).toEqual({
      kind: 'tool',
      name: 'debug_execution',
      summary: 'stopped…',
      expandId: 1,
      expanded: true,
    })
    expect(result.transcript.stored.get(1)).toBe('stopped at src/a.ts:4\nframe 0')
    // Re-opening keeps the requested state without changing anything.
    expect(expandTranscript(result.transcript, ['1'])).toEqual({ ok: true, transcript: result.transcript })
  })

  it('reports user-visible errors for missing, malformed, and unknown expand ids', () => {
    const state = createTranscript()
    expect(expandTranscript(state, [])).toEqual({
      ok: false,
      message: 'expand requires a number; :expand <n> opens a stored output',
    })
    expect(expandTranscript(state, ['two'])).toEqual({ ok: false, message: 'expand: "two" is not a number' })
    expect(expandTranscript(state, ['1', '2']).ok).toBe(false)
    expect(expandTranscript(state, ['7'])).toEqual({
      ok: false,
      message: 'expand: no stored output 7; truncated entries show (:expand n)',
    })
  })

  it('drops stored outputs whose entries the cap evicted', () => {
    let state = createTranscript({ maxEntries: 1 })
    state = appendTranscript(state, { kind: 'tool', name: 'first', summary: 'a…', fullText: 'first output' })
    state = appendTranscript(state, { kind: 'tool', name: 'second', summary: 'b…', fullText: 'second output' })
    expect(state.entries).toHaveLength(1)
    expect(state.entries[0]).toEqual({ kind: 'tool', name: 'second', summary: 'b…', expandId: 2 })
    expect(state.stored.has(1)).toBe(false)
    expect(state.stored.get(2)).toBe('second output')
  })
})
