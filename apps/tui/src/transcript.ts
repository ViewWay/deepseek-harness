/**
 * TUI transcript state: ordered user, assistant, and bounded tool entries.
 * @module @deepseek-ai/dsh-tui/transcript
 */

/** One transcript entry. */
export type TuiTranscriptEntry =
  | { readonly kind: 'user'; readonly text: string }
  | { readonly kind: 'assistant'; readonly text: string }
  | { readonly kind: 'tool'; readonly name: string; readonly summary: string }

/** The full transcript state. */
export interface TuiTranscript {
  readonly entries: readonly TuiTranscriptEntry[]
  readonly maxEntries: number
}

/** Bounds for one transcript. */
export interface TuiTranscriptOptions {
  /** Largest retained entry count; the newest survive (default 500). */
  readonly maxEntries?: number
}

/**
 * Create an empty transcript.
 * @param options - retention bounds.
 * @returns the empty transcript.
 */
export function createTranscript(options: TuiTranscriptOptions = {}): TuiTranscript {
  return { entries: [], maxEntries: options.maxEntries ?? 500 }
}

/**
 * Append one entry, keeping the newest when the cap is hit.
 * @param state - the current transcript.
 * @param entry - the entry to append.
 * @returns the next transcript.
 */
export function appendTranscript(state: TuiTranscript, entry: TuiTranscriptEntry): TuiTranscript {
  const entries = [...state.entries, entry]
  return { ...state, entries: entries.length > state.maxEntries ? entries.slice(-state.maxEntries) : entries }
}
