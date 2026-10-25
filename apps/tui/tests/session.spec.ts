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
})
