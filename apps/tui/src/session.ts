/**
 * TUI session: wraps the existing agent-session path with transcript state.
 * It never creates a second conversation store; prompts flow through the same
 * send path headless uses.
 * @module @deepseek-ai/dsh-tui/session
 */

import { appendTranscript, createTranscript } from './transcript.ts'
import type { TuiTranscript, TuiTranscriptEntry } from './transcript.ts'

/** The face the TUI session submits prompts through. */
export interface TuiSessionDeps {
  readonly send: (text: string) => Promise<void>
  readonly sessionId: string
}

/** The TUI session handle. */
export interface TuiSession {
  readonly sessionId: string
  submit(text: string): Promise<void>
  receive(entry: TuiTranscriptEntry): void
  transcript(): TuiTranscript
  /** Notify on transcript changes; returns the unsubscribe function. */
  subscribe(callback: (transcript: TuiTranscript) => void): () => void
}

/**
 * Create one TUI session over the existing send path.
 * @param deps - the send face and the session id.
 * @returns the session handle.
 */
export function createTuiSession(deps: TuiSessionDeps): TuiSession {
  let transcript = createTranscript()
  const listeners = new Set<(transcript: TuiTranscript) => void>()
  const notify = (): void => {
    for (const listener of listeners) listener(transcript)
  }
  return {
    sessionId: deps.sessionId,
    async submit(text: string): Promise<void> {
      transcript = appendTranscript(transcript, { kind: 'user', text })
      notify()
      await deps.send(text)
    },
    receive(entry: TuiTranscriptEntry): void {
      transcript = appendTranscript(transcript, entry)
      notify()
    },
    transcript(): TuiTranscript {
      return transcript
    },
    subscribe(callback: (transcript: TuiTranscript) => void): () => void {
      listeners.add(callback)
      return () => { listeners.delete(callback) }
    },
  }
}
