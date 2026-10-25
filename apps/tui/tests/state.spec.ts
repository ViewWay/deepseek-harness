/**
 * TUI client state: layout and bounded command history, client-local only.
 */

import { describe, expect, it } from 'vitest'
import { createTuiClientState, restoreTuiClientState } from '../src/state.ts'

describe('TUI client state', () => {
  it('round-trips layout and bounded command history without Session state', () => {
    const state = createTuiClientState()
    state.setLayout('debug')
    state.pushCommand(':next')
    expect(restoreTuiClientState(state.serialize())).toMatchObject({ layout: 'debug', history: [':next'] })
  })

  it('bounds the command history', () => {
    const state = createTuiClientState({ maxHistory: 2 })
    state.pushCommand(':a')
    state.pushCommand(':b')
    state.pushCommand(':c')
    const restored = restoreTuiClientState(state.serialize())
    expect(restored.history).toEqual([':b', ':c'])
  })
})
