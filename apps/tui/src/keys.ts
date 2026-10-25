/**
 * TUI key decoding: maps raw Ink input chunks and modifier flags to the keys
 * the app acts on. Ink does not decode function keys, so their xterm escape
 * sequences are matched here; the module stays free of Ink types so tests run
 * without a terminal.
 * @module @deepseek-ai/dsh-tui/keys
 */

/** Modifier flags the decoder needs, mirroring the subset of Ink's `Key` it reads. */
export interface TuiKeyMods {
  readonly return: boolean
  readonly backspace: boolean
  readonly delete: boolean
  readonly tab: boolean
  readonly escape: boolean
  readonly ctrl: boolean
}

/** One decoded key press. */
export type TuiKey =
  | { readonly kind: 'return' }
  | { readonly kind: 'backspace' }
  | { readonly kind: 'delete' }
  | { readonly kind: 'tab' }
  | { readonly kind: 'escape' }
  | { readonly kind: 'ctrl-c' }
  | { readonly kind: 'print'; readonly text: string }
  | { readonly kind: 'other' }

/** The function keys the TUI acts on. */
export type TuiFunctionKey =
  | 'f5'
  | 'shift-f5'
  | 'f6'
  | 'f7'
  | 'f9'
  | 'f10'
  | 'f11'
  | 'shift-f11'

/**
 * Xterm function-key sequences. Ink parses these internally but reports them
 * with an empty `input` and no public flag, so the TUI listens for them on
 * stdin directly; shifted keys send both modern and legacy forms.
 */
export const FUNCTION_SEQUENCES: ReadonlyMap<string, TuiFunctionKey> = new Map([
  ['\x1b[15~', 'f5'],
  ['\x1b[15;2~', 'shift-f5'],
  ['\x1b[15$', 'shift-f5'],
  ['\x1b[17~', 'f6'],
  ['\x1b[18~', 'f7'],
  ['\x1b[20~', 'f9'],
  ['\x1b[21~', 'f10'],
  ['\x1b[23~', 'f11'],
  ['\x1b[23;2~', 'shift-f11'],
  ['\x1b[23$', 'shift-f11'],
])

/**
 * Decode one raw function-key chunk.
 * @param chunk - the stdin chunk as received.
 * @returns the function key, or `undefined` when the chunk is not one.
 */
export function functionKeyOf(chunk: string): TuiFunctionKey | undefined {
  return FUNCTION_SEQUENCES.get(chunk)
}

/** The modifier flags when no modifier key is held, for callers with no Ink `Key` at hand. */
export const NO_MODS: TuiKeyMods = {
  return: false,
  backspace: false,
  delete: false,
  tab: false,
  escape: false,
  ctrl: false,
}

/**
 * Decode one Ink input chunk into the key the TUI acts on. Ink hands Ctrl+C as
 * `input: 'c'` with `ctrl` held, function keys arrive with an empty `input`
 * and are handled by {@link functionKeyOf} instead.
 * @param input - the raw input string Ink reported for the press.
 * @param mods - the modifier flags Ink reported for the same press.
 * @returns the decoded key; `print` carries the printable text, `other` is inert.
 */
export function parseTuiKey(input: string, mods: TuiKeyMods): TuiKey {
  if (input === '\u0003' || (mods.ctrl && (input === 'c' || input === 'C'))) return { kind: 'ctrl-c' }
  if (mods.return) return { kind: 'return' }
  if (mods.backspace) return { kind: 'backspace' }
  if (mods.delete) return { kind: 'delete' }
  if (mods.tab) return { kind: 'tab' }
  if (mods.escape) return { kind: 'escape' }
  const text = [...input].filter(char => char >= ' ' && char !== '\x7f').join('')
  if (text !== '') return { kind: 'print', text }
  return { kind: 'other' }
}
