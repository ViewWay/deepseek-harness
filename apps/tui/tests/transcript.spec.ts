/**
 * TUI transcript: ordered user, assistant, and bounded tool entries.
 */

import { describe, expect, it } from 'vitest'
import { appendTranscript, createTranscript } from '../src/transcript.ts'

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
})
