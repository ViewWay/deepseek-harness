/**
 * The TUI application entry: re-exports the pure-logic modules and the
 * interactive-loop mount for the bundle's composition layer.
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
export { NO_MODS, parseTuiKey } from './keys.ts'
export type { TuiKey, TuiKeyMods } from './keys.ts'
export { createTuiApprovalQueue, installTuiApproval } from './approval.ts'
export type { TuiApprovalAnswer, TuiApprovalQueue, TuiApprovalRequest } from './approval.ts'
export { createTuiTranscriptFeed } from './feed.ts'
export type { TuiTranscriptFeed, TuiTranscriptFeedOptions } from './feed.ts'
export { mountTuiApp } from './run.ts'

export const name = 'tui'

export const inject = ['cmdlineArgs']

export { apply } from './startup.ts'
