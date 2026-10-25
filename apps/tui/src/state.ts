/**
 * TUI client state: layout and bounded command history, client-local only;
 * never written to the Session log.
 * @module @deepseek-ai/dsh-tui/state
 */

/** The three TUI layouts. */
export type TuiLayout = 'chat' | 'split' | 'debug'

/** The serialized client state. */
export interface TuiClientStateData {
  readonly layout: TuiLayout
  readonly history: readonly string[]
}

/** Bounds for the client state. */
export interface TuiClientStateOptions {
  /** Largest command history entries; the newest survive (default 100). */
  readonly maxHistory?: number
}

/** Mutable client state handle. */
export interface TuiClientState {
  setLayout(layout: TuiLayout): void
  pushCommand(command: string): void
  serialize(): TuiClientStateData
}

/**
 * Create the client state.
 * @param options - retention bounds.
 * @returns the state handle.
 */
export function createTuiClientState(options: TuiClientStateOptions = {}): TuiClientState {
  const maxHistory = options.maxHistory ?? 100
  let layout: TuiLayout = 'chat'
  let history: string[] = []
  return {
    setLayout(next: TuiLayout): void {
      layout = next
    },
    pushCommand(command: string): void {
      history = [...history, command].slice(-maxHistory)
    },
    serialize(): TuiClientStateData {
      return { layout, history }
    },
  }
}

/**
 * Restore the client state from its serialized form.
 * @param data - the serialized state.
 * @returns the restored data, clamped to known layouts.
 */
export function restoreTuiClientState(data: TuiClientStateData): TuiClientStateData {
  const layout = data.layout === 'split' || data.layout === 'debug' ? data.layout : 'chat'
  return { layout, history: data.history }
}
