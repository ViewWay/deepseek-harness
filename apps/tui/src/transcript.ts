/**
 * TUI transcript state: ordered user, assistant, and bounded tool entries.
 * Tool outputs whose summary truncated keep the full text stored behind a
 * sequential expand id; `:expand <n>` opens the stored text for rendering.
 * @module @deepseek-ai/dsh-tui/transcript
 */

/** One transcript entry as stored. */
export type TuiTranscriptEntry =
  | { readonly kind: 'user'; readonly text: string }
  | { readonly kind: 'assistant'; readonly text: string }
  | {
    readonly kind: 'tool'
    readonly name: string
    readonly summary: string
    /** Identifies the stored full output; present only when the summary truncated it. */
    readonly expandId?: number
    /** Present once `:expand <expandId>` opened the stored full output for rendering. */
    readonly expanded?: boolean
  }

/** One derived tool entry whose bounded summary truncated the full output. */
export interface TuiToolOutput {
  readonly kind: 'tool'
  readonly name: string
  readonly summary: string
  /** The untruncated output; the store keeps it behind the assigned expand id. */
  readonly fullText: string
}

/** One entry as derived from events, before the store bounds and ids it. */
export type TuiTranscriptInput = TuiTranscriptEntry | TuiToolOutput

/** The full transcript state. */
export interface TuiTranscript {
  readonly entries: readonly TuiTranscriptEntry[]
  readonly maxEntries: number
  /** Full outputs keyed by the expand ids their truncated tool entries carry. */
  readonly stored: ReadonlyMap<number, string>
  /** The id the next stored output receives. */
  readonly nextExpandId: number
}

/** Bounds for one transcript. */
export interface TuiTranscriptOptions {
  /** Largest retained entry count; the newest survive (default 500). */
  readonly maxEntries?: number
}

/** The outcome of one `:expand` command against the transcript. */
export type TuiExpandResult =
  | { readonly ok: true; readonly transcript: TuiTranscript }
  | { readonly ok: false; readonly message: string }

/**
 * Create an empty transcript.
 * @param options - retention bounds.
 * @returns the empty transcript.
 */
export function createTranscript(options: TuiTranscriptOptions = {}): TuiTranscript {
  return { entries: [], maxEntries: options.maxEntries ?? 500, stored: new Map(), nextExpandId: 1 }
}

/**
 * Append one entry, keeping the newest when the cap is hit. A tool entry that
 * carries a full output keeps it stored behind the next expand id instead of
 * the entry itself.
 * @param state - the current transcript.
 * @param entry - the entry to append.
 * @returns the next transcript.
 */
export function appendTranscript(state: TuiTranscript, entry: TuiTranscriptInput): TuiTranscript {
  if (entry.kind === 'tool' && 'fullText' in entry) {
    const expandId = state.nextExpandId
    const stored: TuiTranscriptEntry = { kind: 'tool', name: entry.name, summary: entry.summary, expandId }
    return commit(state, [...state.entries, stored], { id: expandId, text: entry.fullText })
  }
  return commit(state, [...state.entries, entry], undefined)
}

/**
 * Open the stored output one `:expand` command names. The matching tool entry
 * renders its full text afterwards; re-opening an already-expanded entry keeps
 * the requested state.
 * @param state - the current transcript.
 * @param args - the raw `:expand` command arguments.
 * @returns the next transcript, or a user-visible error message.
 */
export function expandTranscript(state: TuiTranscript, args: readonly string[]): TuiExpandResult {
  const arg = args.length === 1 ? args[0] : undefined
  if (arg === undefined) {
    return { ok: false, message: 'expand requires a number; :expand <n> opens a stored output' }
  }
  if (!/^\d+$/.test(arg)) return { ok: false, message: `expand: "${arg}" is not a number` }
  const id = Number.parseInt(arg, 10)
  const index = state.entries.findIndex(entry => entry.kind === 'tool' && entry.expandId === id)
  if (index === -1) {
    return { ok: false, message: `expand: no stored output ${id}; truncated entries show (:expand n)` }
  }
  const target = state.entries[index]
  if (target === undefined || target.kind !== 'tool' || target.expanded === true) {
    return { ok: true, transcript: state }
  }
  const entries = state.entries.map((entry, position): TuiTranscriptEntry =>
    position === index && entry.kind === 'tool' ? { ...entry, expanded: true } : entry,
  )
  return { ok: true, transcript: { ...state, entries } }
}

/**
 * Apply the retention cap plus the stored-output invariant: every stored id
 * stays referenced by a kept entry, so an evicted entry drops its full output.
 * @param state - the transcript the change applies to.
 * @param entries - the next entry list before the cap.
 * @param added - the stored output this change adds, if any.
 * @returns the next transcript.
 */
function commit(
  state: TuiTranscript,
  entries: readonly TuiTranscriptEntry[],
  added: { readonly id: number; readonly text: string } | undefined,
): TuiTranscript {
  const kept = entries.length > state.maxEntries ? entries.slice(-state.maxEntries) : entries
  const stored = new Map(state.stored)
  if (added !== undefined) stored.set(added.id, added.text)
  const live = new Set<number>()
  for (const entry of kept) {
    if (entry.kind === 'tool' && entry.expandId !== undefined) live.add(entry.expandId)
  }
  for (const id of [...stored.keys()]) {
    if (!live.has(id)) stored.delete(id)
  }
  const nextExpandId = added === undefined ? state.nextExpandId : state.nextExpandId + 1
  return { entries: kept, maxEntries: state.maxEntries, stored, nextExpandId }
}
