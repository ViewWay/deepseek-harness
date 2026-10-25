/**
 * The TUI application entry: re-exports the pure-logic modules for the
 * bundle's composition layer. The Ink app component lands with the Ink
 * dependency registration.
 * @module @deepseek-ai/dsh-tui
 */

export { appendTranscript, createTranscript } from './transcript.ts'
export type { TuiTranscript, TuiTranscriptEntry, TuiTranscriptOptions } from './transcript.ts'
export { parseTuiInput } from './input.ts'
export type { TuiInput } from './input.ts'
export { createTuiClientState, restoreTuiClientState } from './state.ts'
export type { TuiClientState, TuiClientStateData, TuiClientStateOptions, TuiLayout } from './state.ts'
export { createTuiSession } from './session.ts'
export type { TuiSession, TuiSessionDeps } from './session.ts'

export const name = 'tui'

export const inject = ['cmdlineArgs']

export { apply } from './startup.ts'
